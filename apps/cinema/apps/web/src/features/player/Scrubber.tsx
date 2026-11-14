import { useRef, useState } from 'react'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'

export type ScrubMarker = {
  at: number
  state: 'pending' | 'right' | 'wrong'
  label: string
}

type Props = {
  current: number
  duration: number
  /** Seconds buffered ahead of the playhead. */
  buffered: number
  onSeek: (seconds: number) => void
  markers?: ScrubMarker[]
}

/**
 * The seek bar. A native range input does the interaction -- keyboard, drag,
 * touch and screen readers all come free -- and three stacked spans draw it,
 * because styling a range's track across browsers is worse than not using it.
 */
export function Scrubber({ current, duration, buffered, onSeek, markers }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverAt, setHoverAt] = useState<number | null>(null)

  const pct = (seconds: number) => (duration ? Math.min(100, (seconds / duration) * 100) : 0)

  return (
    <div className="group/scrub relative flex h-5 items-center">
      <div ref={trackRef} className="relative h-1 w-full rounded-pill bg-white/25">
        <span
          className="absolute inset-y-0 left-0 rounded-pill bg-white/35"
          style={{ width: `${pct(buffered)}%` }}
        />
        <span
          className="absolute inset-y-0 left-0 rounded-pill bg-primary"
          style={{ width: `${pct(current)}%` }}
        />
        <span
          className={cn(
            'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-primary',
            'scale-0 transition-transform group-hover/scrub:scale-100',
          )}
          style={{ left: `${pct(current)}%` }}
        />
        {/* Under the range input, so a click near a dot still seeks. */}
        {duration > 0 &&
          markers?.map((marker, index) => (
            <span
              key={index}
              title={marker.label}
              className={cn(
                'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-pill ring-2 ring-black/60',
                marker.state === 'right' ? 'bg-match' : marker.state === 'wrong' ? 'bg-destructive' : 'bg-white',
              )}
              style={{ left: `${pct(marker.at)}%` }}
            />
          ))}
      </div>

      {hoverAt != null && (
        <span
          className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md bg-scrim px-2 py-1 font-mono text-xs tabular-nums"
          style={{ left: `${pct(hoverAt)}%` }}
        >
          {formatTimecode(hoverAt)}
        </span>
      )}

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={1}
        value={current}
        aria-label="Seek"
        aria-valuetext={`${formatTimecode(current)} of ${formatTimecode(duration)}`}
        onChange={(event) => onSeek(Number(event.target.value))}
        onPointerMove={(event) => {
          const rect = trackRef.current?.getBoundingClientRect()
          if (!rect || !duration) return
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
          setHoverAt(ratio * duration)
        }}
        onPointerLeave={() => setHoverAt(null)}
        className="absolute inset-x-0 h-5 w-full cursor-pointer appearance-none bg-transparent opacity-0"
      />
    </div>
  )
}
