import { useEffect, useRef, useState } from 'react'
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

  // Read inside intervals and unmount cleanup without re-subscribing.
  const sourceRef = useRef<PlaybackSource | null>(null)
  sourceRef.current = source

  // 1. Negotiate.
  useEffect(() => {
    if (!itemId || !userId) return
    let cancelled = false
    setSource(null)
    setError(null)

    resolvePlaybackSource(api, {
      itemId,
      userId,
      startTimeTicks: secondsToTicks(startSeconds),
      maxStreamingBitrate,
    })
      .then((resolved) => {
        if (!cancelled) setSource(resolved)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Playback failed')
      })

    return () => {
      cancelled = true
    }
  }, [api, itemId, userId, startSeconds, maxStreamingBitrate])

  // 2. Report start, tick progress, report stop.
  useEffect(() => {
    if (!itemId || !source) return

    const position = () => secondsToTicks(videoRef.current?.currentTime ?? startSeconds)

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
      const stopped = sourceRef.current
      if (!stopped) return
      // Fire-and-forget: this both saves the resume point and kills any
      // running ffmpeg transcode on the server.
      void reportPlaybackStopped(api, {
        itemId,
        source: stopped,
        positionTicks: position(),
      }).finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['resume'] })
        void queryClient.invalidateQueries({ queryKey: ['item'] })
      })
    }
  }, [api, itemId, source, startSeconds, queryClient])

  return { videoRef, source, error }
}
