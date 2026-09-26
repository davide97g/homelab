import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TrackMenuItem = {
  /** Stream index, or null for the "Off" row. */
  value: number | null
  label: string
  hint?: string
}

type Props = {
  label: string
  icon: React.ReactNode
  heading: string
  items: TrackMenuItem[]
  selected: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (value: number | null) => void
}

/**
 * A control-bar button with a list that opens upward, over the film. Open
 * state is lifted so the player can keep its chrome up while a menu is open.
 */
export function TrackMenu({
  label,
  icon,
  heading,
  items,
  selected,
  open,
  onOpenChange,
  onSelect,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-pill text-white/90 transition-colors',
          'hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none',
          open && 'bg-white/10 text-white',
        )}
      >
        {icon}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={heading}
          className="absolute right-0 bottom-full z-50 mb-2 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-[var(--hairline)] bg-surface p-1 shadow-panel"
        >
          <p className="px-3 py-2 text-xs text-muted-foreground">{heading}</p>
          {items.map((item) => {
            const active = item.value === selected
            return (
              <button
                key={item.value ?? 'off'}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onSelect(item.value)
                  onOpenChange(false)
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Check className={cn('mt-0.5 size-4 shrink-0', !active && 'invisible')} />
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  {item.hint && <span className="block text-xs text-muted-foreground">{item.hint}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
