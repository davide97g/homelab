import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/jellyfin/auth'
import { secondsToTicks } from '@/lib/jellyfin/ticks'
import {
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  resolvePlaybackSource,
  type PlaybackSource,
} from '@/lib/jellyfin/playback'

const PROGRESS_INTERVAL_MS = 10_000

type Options = {
  itemId: string | undefined
  startSeconds: number
  /** Set to force a transcode for testing, e.g. 3_000_000 (3 Mbps). */
  maxStreamingBitrate?: number
}

type Renegotiation = {
  itemId: string
  mediaSourceId: string
  startSeconds: number
  audioStreamIndex?: number
  /** An image subtitle the server paints into the picture. */
  burnSubtitleIndex?: number
}

type SubtitleChoice = {
  itemId: string
  index: number | null
}

/**
 * Owns the server side of playback: negotiates the stream, then keeps the
 * session alive with progress reports and tears it down on exit.
 *
 * The media element is deliberately NOT owned here -- this hook exposes a ref
 * for the caller to attach, so the same session logic could drive a different
 * player implementation.
 */
export function usePlaybackSession({ itemId, startSeconds, maxStreamingBitrate }: Options) {
  const { api, userId } = useAuth()
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [source, setSource] = useState<PlaybackSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [negotiating, setNegotiating] = useState(false)

  // A track change is a new session for the same item, resumed where the old
  // one was. Keyed by item so navigating elsewhere drops it on its own.
  const [renegotiation, setRenegotiation] = useState<Renegotiation | null>(null)
  const pending = renegotiation && renegotiation.itemId === itemId ? renegotiation : null
  const resumeSeconds = pending?.startSeconds ?? startSeconds
  const mediaSourceId = pending?.mediaSourceId
  const audioStreamIndex = pending?.audioStreamIndex
  const burnSubtitleIndex = pending?.burnSubtitleIndex
  const isSwitch = pending !== null

  // Text subtitles switch in the browser, no session involved. null is "off".
  const [subtitleChoice, setSubtitleChoice] = useState<SubtitleChoice | null>(null)
  const subtitleIndex =
    subtitleChoice && subtitleChoice.itemId === itemId
      ? subtitleChoice.index
      : (source?.defaultSubtitleIndex ?? null)

  // Where the old session stopped, captured before its <video> is reset to
  // take the new URL -- after that currentTime reads 0.
  const handoffSeconds = useRef<number | null>(null)
  // Read by the reporting effect without restarting it on every switch.
  const resumeRef = useRef(resumeSeconds)
  resumeRef.current = resumeSeconds

  // 1. Negotiate.
  useEffect(() => {
    if (!itemId || !userId) return
    let cancelled = false
    // On a track switch the old stream keeps playing until the new one is ready.
    if (!isSwitch) setSource(null)
    setError(null)
    setNegotiating(true)

    resolvePlaybackSource(api, {
      itemId,
      userId,
      startTimeTicks: secondsToTicks(resumeSeconds),
      maxStreamingBitrate,
      mediaSourceId,
      audioStreamIndex,
      subtitleStreamIndex: burnSubtitleIndex,
    })
      .then((resolved) => {
        if (!cancelled) setSource(resolved)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Playback failed')
      })
      .finally(() => {
        if (!cancelled) setNegotiating(false)
      })

    return () => {
      cancelled = true
    }
  }, [api, itemId, userId, resumeSeconds, maxStreamingBitrate, mediaSourceId, audioStreamIndex, burnSubtitleIndex, isSwitch])

  // 2. Report start, tick progress, report stop.
  useEffect(() => {
    if (!itemId || !source) return

    const position = () => secondsToTicks(videoRef.current?.currentTime ?? resumeRef.current)
    handoffSeconds.current = null

    void reportPlaybackStart(api, { itemId, source, positionTicks: position() })

    const interval = window.setInterval(() => {
      const video = videoRef.current
      if (!video) return
      void reportPlaybackProgress(api, {
        itemId,
        source,
        positionTicks: position(),
        isPaused: video.paused,
        isMuted: video.muted,
        volumeLevel: video.volume,
      })
    }, PROGRESS_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
      // Fire-and-forget: this both saves the resume point and kills any
      // running ffmpeg transcode on the server. `source` is this effect's own
      // session, so a replaced one is stopped too, not just the last.
      const handoff = handoffSeconds.current
      void reportPlaybackStopped(api, {
        itemId,
        source,
        positionTicks: handoff === null ? position() : secondsToTicks(handoff),
      }).finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['resume'] })
        void queryClient.invalidateQueries({ queryKey: ['item'] })
      })
    }
  }, [api, itemId, source, queryClient])

  const renegotiate = useCallback(
    (change: Partial<Pick<Renegotiation, 'audioStreamIndex' | 'burnSubtitleIndex'>>) => {
      if (!itemId || !source) return
      const seconds = videoRef.current?.currentTime ?? resumeSeconds
      handoffSeconds.current = seconds
      setRenegotiation((previous) => ({
        ...(previous?.itemId === itemId ? previous : {}),
        ...change,
        itemId,
        mediaSourceId: source.mediaSourceId,
        startSeconds: seconds,
      }))
    },
    [itemId, source, resumeSeconds],
  )

  const selectAudio = useCallback(
    (index: number) => {
      if (!source || index === source.audioStreamIndex) return
      renegotiate({ audioStreamIndex: index })
    },
    [source, renegotiate],
  )

  const selectSubtitle = useCallback(
    (index: number | null) => {
      if (!source || !itemId) return
      setSubtitleChoice({ itemId, index })
      const burnIn = source.subtitleOptions.find((option) => option.index === index)?.burnIn
      const wanted = burnIn ? (index ?? undefined) : undefined
      // Only an image track, or leaving one, needs the server.
      if (wanted !== source.burnedSubtitleIndex) renegotiate({ burnSubtitleIndex: wanted })
    },
    [source, itemId, renegotiate],
  )

  return {
    videoRef,
    source,
    error,
    resumeSeconds,
    switching: negotiating && isSwitch,
    subtitleIndex,
    selectAudio,
    selectSubtitle,
  }
}
