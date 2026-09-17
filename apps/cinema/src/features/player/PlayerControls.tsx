import { useEffect, useState } from 'react'
import { ArrowLeft, Maximize, Minimize, Pause, Play } from 'lucide-react'
import { HoloBadge } from '@/components/ui/holo-badge'
import { QuackButton } from '@/components/ui/quack-button'
import { DuckMediaSlider } from '@/components/ui/duck-media-slider'
import { DuckVolume } from '@/components/ui/duck-volume'
import { StickerKbd } from '@/components/ui/sticker-kbd'
import { PlayMethod } from '@/lib/jellyfin/playback'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  title: string
  playMethod: PlayMethod
  visible: boolean
  onBack: () => void
}

export function PlayerControls({ videoRef, title, playMethod, visible, onBack }: Props) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  // Mirror the media element's state instead of trying to command it. The
  // element is the source of truth; React just renders it.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const sync = () => {
      setPlaying(!video.paused)
      setMuted(video.muted)
      setVolume(video.volume)
      setCurrent(video.currentTime)
      const total = Number.isFinite(video.duration) ? video.duration : 0
      setDuration(total)
      // The range holding the playhead, as a fraction of the whole file --
      // which is the shape DuckMediaSlider wants for its buffer waterline.
      const ranges = video.buffered
      let ahead = 0
      for (let i = 0; i < ranges.length; i += 1) {
        if (ranges.start(i) <= video.currentTime && video.currentTime <= ranges.end(i)) {
          ahead = ranges.end(i)
          break
        }
      }
      setBuffered(total ? ahead / total : 0)
    }

    const events = [
      'play',
      'pause',
      'timeupdate',
      'durationchange',
      'volumechange',
      'loadedmetadata',
      'progress',
    ]
    events.forEach((event) => video.addEventListener(event, sync))
    sync()
    return () => events.forEach((event) => video.removeEventListener(event, sync))
  }, [videoRef])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Keyboard shortcuts people expect from a video player.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          if (video.paused) void video.play()
          else video.pause()
          break
        case 'ArrowRight':
          video.currentTime += 10
          break
        case 'ArrowLeft':
          video.currentTime -= 10
          break
        case 'm':
          video.muted = !video.muted
          break
        case 'f':
          void toggleFullscreen()
          break
        case 'Escape':
          if (!document.fullscreenElement) onBack()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [videoRef, onBack])

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  }

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-transparent to-black/60 transition-opacity duration-300',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="flex items-center gap-3 p-4 md:p-6">
        <QuackButton variant="outline" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </QuackButton>
        <span className="truncate font-display font-bold">{title}</span>
        {/* The badge that tells you whether your setup is actually working:
            holo when the server is burning CPU, quiet otherwise. */}
        <HoloBadge
          variant={playMethod === PlayMethod.Transcode ? 'holo' : 'outline'}
          className="ml-auto"
        >
          {playMethod === PlayMethod.Transcode ? 'Transcoding' : playMethod}
        </HoloBadge>
      </div>

      <div className="space-y-3 p-4 md:p-6">
        {/*
          The slider owns the value while a drag is in flight, so `timeupdate`
          firing four times a second cannot pull the thumb back to the playhead
          mid-gesture. Seeking happens once, on release, through onSeek.
        */}
        <DuckMediaSlider
          aria-label="Seek"
          dense
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(current, duration || 0)}
          buffered={buffered}
          preview={(v) => formatTimecode(v)}
          formatValue={(v) => `${formatTimecode(v)} of ${formatTimecode(duration)}`}
          onSeek={(v) => {
            const video = videoRef.current
            if (video) video.currentTime = v
          }}
          disabled={!duration}
        />

        <div className="flex items-center gap-3">
          <QuackButton
            variant="primary"
            size="icon"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              const video = videoRef.current
              if (!video) return
              if (video.paused) void video.play()
              else video.pause()
            }}
          >
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </QuackButton>

          {/* Muted and volume stay independent, mirroring the element -- the
              component reads silence from either one. */}
          <DuckVolume
            volume={volume}
            muted={muted}
            onVolumeChange={(v) => {
              const video = videoRef.current
              if (video) video.volume = v
            }}
            onMutedChange={(next) => {
              const video = videoRef.current
              if (video) video.muted = next
            }}
          />

          <span className="font-mono text-xs tabular-nums text-foreground/80">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <StickerKbd watch="k">K</StickerKbd>
              play
              <StickerKbd watch="m">M</StickerKbd>
              mute
              <StickerKbd watch="f">F</StickerKbd>
              full
            </span>
            <QuackButton
              variant="ghost"
              size="icon"
              aria-label="Fullscreen"
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </QuackButton>
          </div>
        </div>
      </div>
    </div>
  )
}
