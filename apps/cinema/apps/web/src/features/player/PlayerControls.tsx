import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { PlayMethod } from '@/lib/jellyfin/playback'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'
import { Scrubber } from './Scrubber'

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  title: string
  subtitle?: string
  playMethod: PlayMethod
  visible: boolean
  onBack: () => void
}

const SKIP = 10

export function PlayerControls({
  videoRef,
  title,
  subtitle,
  playMethod,
  visible,
  onBack,
}: Props) {
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
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      // The end of the range holding the playhead: what is actually watchable
      // from here without waiting, which is the only buffer worth drawing.
      const ranges = video.buffered
      let ahead = 0
      for (let i = 0; i < ranges.length; i += 1) {
        if (ranges.start(i) <= video.currentTime && video.currentTime <= ranges.end(i)) {
          ahead = ranges.end(i)
          break
        }
      }
      setBuffered(ahead)
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
        case 'l':
          video.currentTime += SKIP
          break
        case 'ArrowLeft':
        case 'j':
          video.currentTime -= SKIP
          break
        case 'ArrowUp':
          event.preventDefault()
          video.volume = Math.min(1, video.volume + 0.1)
          break
        case 'ArrowDown':
          event.preventDefault()
          video.volume = Math.max(0, video.volume - 0.1)
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

  const video = videoRef.current
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col justify-between transition-opacity duration-300',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* Two washes rather than one overlay: the middle of the frame, which is
          where the film is, stays untouched. */}
      <div className="flex items-start gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 pb-16 md:p-6 md:pb-20">
        <IconButton label="Back" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <div className="min-w-0 pt-1.5">
          <p className="truncate font-semibold">{title}</p>
          {subtitle && <p className="truncate text-sm text-white/60">{subtitle}</p>}
        </div>
        {playMethod === PlayMethod.Transcode && (
          <span className="ml-auto shrink-0 rounded-pill bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
            Transcoding
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 bg-gradient-to-t from-black/85 to-transparent p-4 pt-20 md:p-6 md:pt-24">
        <Scrubber
          current={current}
          duration={duration}
          buffered={buffered}
          onSeek={(seconds) => {
            if (video) video.currentTime = seconds
          }}
        />

        <div className="flex items-center gap-1 md:gap-2">
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (!video) return
              if (video.paused) void video.play()
              else video.pause()
            }}
          >
            {playing ? (
              <Pause className="size-6 fill-current" />
            ) : (
              <Play className="size-6 fill-current" />
            )}
          </IconButton>

          <IconButton
            label={`Back ${SKIP} seconds`}
            onClick={() => video && (video.currentTime -= SKIP)}
          >
            <RotateCcw className="size-5" />
          </IconButton>
          <IconButton
            label={`Forward ${SKIP} seconds`}
            onClick={() => video && (video.currentTime += SKIP)}
          >
            <RotateCw className="size-5" />
          </IconButton>

          {/* The slider only exists once you reach for the speaker, which is
              the only time anyone wants it. */}
          <div className="group/vol flex items-center">
            <IconButton
              label={muted ? 'Unmute' : 'Mute'}
              onClick={() => video && (video.muted = !video.muted)}
            >
              <VolumeIcon className="size-5" />
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => {
                if (!video) return
                video.volume = Number(event.target.value)
                video.muted = Number(event.target.value) === 0
              }}
              className="h-1 w-0 cursor-pointer appearance-none rounded-pill bg-white/30 opacity-0 transition-all duration-[var(--duration-base)] group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <span className="pl-2 font-mono text-xs tabular-nums text-white/80">
            {formatTimecode(current)} <span className="text-white/40">/ {formatTimecode(duration)}</span>
          </span>

          <IconButton
            label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => void toggleFullscreen()}
            className="ml-auto"
          >
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </IconButton>
        </div>
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-pill text-white/90 transition-colors',
        'hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none',
        className,
      )}
    >
      {children}
    </button>
  )
}
