import { useEffect, useRef } from 'react'
import { BadgeQuestionMark, ListChecks, Plus, RotateCcw } from 'lucide-react'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'

type Props = {
  enabled: boolean
  onEnabledChange: (on: boolean) => void
  count: number
  score: { right: number; answered: number }
  now: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddHere: () => void
  onEditAll: () => void
  onRestart: () => void
}

/**
 * The quiz switch in the control bar. Off by default and remembered: when it
 * is off, nothing about the quiz shows except this button.
 */
export function QuizMenu({
  enabled,
  onEnabledChange,
  count,
  score,
  now,
  open,
  onOpenChange,
  onAddHere,
  onEditAll,
  onRestart,
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

  const item =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={enabled ? 'Quiz: on' : 'Quiz: off'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'relative grid size-10 shrink-0 place-items-center rounded-pill text-white/90 transition-colors',
          'hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none',
          open && 'bg-white/10 text-white',
        )}
      >
        <BadgeQuestionMark className="size-5" />
        {enabled && <span className="absolute top-2 right-2 size-2 rounded-pill bg-primary" />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Quiz"
          className="absolute right-0 bottom-full z-50 mb-2 w-72 rounded-lg border border-[var(--hairline)] bg-surface p-1 shadow-panel"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={enabled}
            onClick={() => onEnabledChange(!enabled)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Quiz</span>
              <span className="block text-xs text-muted-foreground">
                {count === 0
                  ? 'No questions for this film yet'
                  : enabled
                    ? `${score.right} right of ${score.answered} answered · ${count} questions`
                    : `${count} questions, stops the film to ask`}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-pill transition-colors',
                enabled ? 'bg-primary' : 'bg-white/20',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 size-4 rounded-pill bg-white transition-transform',
                  enabled && 'translate-x-4',
                )}
              />
            </span>
          </button>

          <div className="my-1 h-px bg-[var(--hairline)]" />

          <button type="button" role="menuitem" onClick={onAddHere} className={item}>
            <Plus className="size-4" /> Add a question at {formatTimecode(now)}
          </button>
          <button type="button" role="menuitem" onClick={onEditAll} className={item}>
            <ListChecks className="size-4" /> Edit questions
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onRestart}
            disabled={score.answered === 0}
            className={item}
          >
            <RotateCcw className="size-4" /> Reset answers
          </button>
        </div>
      )}
    </div>
  )
}
