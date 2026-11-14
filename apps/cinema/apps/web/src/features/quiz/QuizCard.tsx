import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { QUIZ_TYPE_LABEL, freeAnswerIsRight, rightAnswer, type QuizQuestion } from './quiz'

type Props = {
  question: QuizQuestion
  number: number
  total: number
  /** Called once, when the viewer commits to an answer. */
  onAnswer: (right: boolean) => void
  /** Back to the film, answered or skipped. */
  onClose: () => void
}

/**
 * The question, over a darkened frame. Answering locks it and shows the
 * verdict; Continue resumes the film. Skipping leaves it unanswered, so it
 * asks again next time playback crosses it.
 */
export function QuizCard({ question, number, total, onAnswer, onClose }: Props) {
  const [verdict, setVerdict] = useState<boolean | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (question.type === 'text') inputRef.current?.focus()
  }, [question])
  useEffect(() => {
    if (verdict !== null) continueRef.current?.focus()
  }, [verdict])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commit = (right: boolean) => {
    if (verdict !== null) return
    setVerdict(right)
    onAnswer(right)
  }

  const choices =
    question.type === 'choice' ? question.options : question.type === 'truefalse' ? ['True', 'False'] : []
  const right =
    question.type === 'choice' ? question.answer : question.type === 'truefalse' ? (question.answer ? 0 : 1) : -1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-question"
      className="absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-black/75 p-4"
    >
      <div className="w-full max-w-lg rounded-lg bg-surface p-6 shadow-panel">
        <p className="text-xs text-muted-foreground">
          Question {number} of {total} · {QUIZ_TYPE_LABEL[question.type]} · {formatTimecode(question.at)}
        </p>
        <h2 id="quiz-question" className="mt-2 text-xl font-semibold tracking-tight text-balance">
          {question.question}
        </h2>

        {question.type === 'text' ? (
          <form
            className="mt-5 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (typed.trim()) commit(freeAnswerIsRight(typed, question.accept))
            }}
          >
            <input
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={verdict !== null}
              placeholder="Your answer"
              autoComplete="off"
              aria-label="Your answer"
              className="h-10 min-w-0 flex-1 rounded-md bg-surface-2 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
            />
            <button
              type="submit"
              disabled={verdict !== null || !typed.trim()}
              className="h-10 rounded-md bg-white/10 px-4 text-sm font-semibold transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              Answer
            </button>
          </form>
        ) : (
          <div className="mt-5 grid gap-2">
            {choices.map((label, index) => {
              const isRight = verdict !== null && index === right
              const isWrongPick = verdict !== null && index === picked && index !== right
              return (
                <button
                  key={index}
                  type="button"
                  disabled={verdict !== null}
                  onClick={() => {
                    setPicked(index)
                    commit(index === right)
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-md bg-surface-2 px-4 py-3 text-left text-sm transition-colors',
                    verdict === null && 'hover:bg-surface-3',
                    isRight && 'bg-match/15 text-foreground ring-1 ring-match',
                    isWrongPick && 'bg-destructive/15 ring-1 ring-destructive',
                    verdict !== null && !isRight && !isWrongPick && 'text-muted-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">{label}</span>
                  {isRight && <Check className="size-4 shrink-0 text-match" />}
                  {isWrongPick && <X className="size-4 shrink-0 text-destructive" />}
                </button>
              )
            })}
          </div>
        )}

        {verdict !== null && (
          <div aria-live="polite" className="mt-5">
            <p className={cn('text-lg font-semibold', verdict ? 'text-match' : 'text-destructive')}>
              {verdict ? 'Right!' : 'Wrong'}
            </p>
            {!verdict && (
              <p className="mt-1 text-sm">
                The answer was <span className="font-semibold">{rightAnswer(question)}</span>.
              </p>
            )}
            {question.explain && <p className="mt-1 text-sm text-muted-foreground">{question.explain}</p>}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {verdict === null ? (
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md px-4 text-sm text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              Skip
            </button>
          ) : (
            <button
              ref={continueRef}
              type="button"
              onClick={onClose}
              className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
