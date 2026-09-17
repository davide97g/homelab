import { useEffect, useRef } from 'react'
import Hls from 'hls.js'
import type { PlaybackSource } from '@/lib/jellyfin/playback'

type Props = {
  source: PlaybackSource
  startSeconds: number
  videoRef: React.RefObject<HTMLVideoElement | null>
  onReady?: () => void
  onError?: (message: string) => void
}

/**
 * Thin, dumb media element. Two delivery paths only:
 *   - progressive file  -> assign src directly
 *   - HLS               -> native on Safari, hls.js everywhere else
 */
export function VideoPlayer({ source, startSeconds, videoRef, onReady, onError }: Props) {
  const hlsRef = useRef<Hls | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const canPlayHlsNatively = video.canPlayType('application/vnd.apple.mpegurl') !== ''

    if (source.isHls && !canPlayHlsNatively && Hls.isSupported()) {
      const hls = new Hls({
        // The server already picked the ladder; don't fight it.
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      })
      hlsRef.current = hls
      hls.attachMedia(video)
      hls.loadSource(source.url)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onError?.(`HLS error: ${data.details}`)
      })
    } else {
      video.src = source.url
    }

    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
  }, [source, videoRef, onError])

  return (
    <video
      ref={videoRef}
      className="size-full bg-black"
      autoPlay
      playsInline
      crossOrigin="anonymous"
      onLoadedMetadata={(event) => {
        // A transcode already starts at the requested offset, so only seek
        // when we were handed the whole file.
        if (!source.isHls && startSeconds > 0) {
          event.currentTarget.currentTime = startSeconds
        }
        onReady?.()
      }}
      onError={() => onError?.('The browser could not decode this stream.')}
    >
      {source.subtitleTracks.map((track) => (
        <track
          key={track.index}
          kind="subtitles"
          src={track.url}
          label={track.label}
          srcLang={track.language ?? undefined}
          default={track.isDefault}
        />
      ))}
    </video>
  )
}
