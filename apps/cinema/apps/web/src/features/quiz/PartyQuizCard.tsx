import { useEffect, useRef, useState } from 'react'
import { Check, Crown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cardUrl, hostCall, usePartyState, type PartyPlayer } from './party'
import type { QuizQuestion } from './quiz'

type Props = {
  partyKey: string
  /** Stable per film and question, so a remount asks the same question, not a new one. */
  questionId: string
  question: QuizQuestion
  number: number
  total: number
  /** The question was revealed: Cinema marks it answered on the scrub bar. */
  onRevealed: () => void
  /** Back to the film. */
  onClose: () => void
}

const LETTERS = 'ABCDEFGH'

/**
 * The big-screen half of quiz night. The film is paused; the question goes to
 * every phone, each player's card lights up as they answer, and the reveal
 * shows who got it and the standings. Reveal happens on its own once everyone
 * in the room has answered, or now with Enter.
 */
export function PartyQuizCard({ partyKey, questionId, question, number, total, onRevealed, onClose }: Props) {
  const { state, setState, online } = usePartyState(partyKey)
  const [error, setError] = useState<string | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    hostCall(partyKey, 'ask', { id: questionId, number, total, question })
      .then(setState)
      .catch(() => setError('JARVIS non risponde: i telefoni non vedono la domanda.'))
  }, [partyKey, questionId, number, total, question, setState])

  const current = state?.current?.id === questionId ? state.current : null
  const revealed = current?.phase === 'revealed'

  const revealedOnce = useRef(false)
  useEffect(() => {
    if (revealed && !revealedOnce.current) {
      revealedOnce.current = true
      onRevealed()
    }
  }, [revealed, onRevealed])

  useEffect(() => {
    actionRef.current?.focus()
  }, [revealed])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (revealed) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [revealed])

  const reveal = () => hostCall(partyKey, 'reveal').then(setState).catch(() => setError('Rivelazione non riuscita.'))
  const close = () => {
    hostCall(partyKey, 'close').catch(() => {})
    onClose()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const standings = state?.standings ?? []
  const room = standings.filter((p) => p.joined)
  const answered = new Set(current?.answered ?? [])
  const options =
    question.type === 'choice' ? question.options : question.type === 'truefalse' ? ['Vero', 'Falso'] : []
  const left = current ? Math.max(0, 1 - (now - current.openedAt) / 30_000) : 1
  const lead = standings[0]?.score ?? 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="party-question"
      className="absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-black/80 p-6"
    >
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="rounded-lg bg-surface p-8 shadow-panel">
          <p className="text-sm text-muted-foreground">
            Domanda {number} di {total} · {formatTimecode(question.at)}
            {!online && ' · riconnessione a JARVIS…'}
          </p>
          <h2 id="party-question" className="mt-3 text-4xl font-semibold tracking-tight text-balance">
            {question.question}
          </h2>

          {!revealed && <div className="mt-5 h-1 overflow-hidden rounded-pill bg-white/10">
            <div className="h-full origin-left bg-primary transition-transform" style={{ transform: `scaleX(${left})` }} />
          </div>}

          {options.length > 0 && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {options.map((label, index) => {
                const isRight = revealed && index === current?.rightIndex
                return (
                  <div
                    key={index}
                    className={cn(
                      'flex items-center gap-4 rounded-md bg-surface-2 px-5 py-4 text-xl',
                      isRight && 'bg-match/15 ring-2 ring-match',
                      revealed && !isRight && 'text-muted-foreground',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-white/10 font-semibold">
                      {LETTERS[index]}
                    </span>
                    <span className="min-w-0 flex-1">{label}</span>
                    {isRight && <Check className="size-6 shrink-0 text-match" />}
                  </div>
                )
              })}
            </div>
          )}

          {revealed ? (
            <div aria-live="polite" className="mt-6">
              <p className="text-2xl">
                Risposta: <span className="font-semibold text-match">{current?.right}</span>
              </p>
              {current?.explain && <p className="mt-2 text-lg text-muted-foreground">{current.explain}</p>}
            </div>
          ) : (
            question.type === 'text' && (
              <p className="mt-6 text-xl text-muted-foreground">Risposta libera: scrivetela sul telefono.</p>
            )
          )}

          <div className="mt-8 flex flex-wrap gap-5">
            {room.map((p) => (
              <PlayerChip
                key={p.id}
                partyKey={partyKey}
                player={p}
                answered={answered.has(p.id)}
                result={revealed ? current?.results?.[p.id] : undefined}
                revealed={revealed}
              />
            ))}
            {room.length === 0 && (
              <p className="text-muted-foreground">Nessuno è ancora entrato con il suo link.</p>
            )}
          </div>

          {error && <p className="mt-4 text-destructive">{error}</p>}

          <div className="mt-8 flex items-center justify-end gap-3">
            {!revealed && (
              <span className="mr-auto text-muted-foreground">
                {answered.size} di {room.length} hanno risposto
              </span>
            )}
            <button
              type="button"
              onClick={close}
              className="h-10 rounded-md px-4 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              {revealed ? 'Chiudi' : 'Salta'}
            </button>
            <button
              ref={actionRef}
              type="button"
              onClick={revealed ? close : reveal}
              className="h-10 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {revealed ? 'Continua il film' : 'Rivela'}
            </button>
          </div>
        </div>

        <aside className="rounded-lg bg-surface p-6 shadow-panel">
          <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Classifica</h3>
          <ol className="mt-4 grid gap-2">
            {standings.map((p, i) => (
              <li
                key={p.id}
                className={cn('flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2', !p.joined && 'opacity-40')}
              >
                <span className="w-5 text-center font-semibold text-muted-foreground">{i + 1}</span>
                <img src={cardUrl(partyKey, p.id)} alt="" className="h-12 w-9 rounded-sm object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-semibold">
                    {p.name}
                    {i === 0 && lead > 0 && <Crown className="size-4 text-primary" />}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.right} giuste
                  </span>
                </span>
                <span className="text-xl font-semibold tabular-nums">{p.score}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  )
}

function PlayerChip({
  partyKey,
  player,
  answered,
  result,
  revealed,
}: {
  partyKey: string
  player: PartyPlayer
  answered: boolean
  result?: { answer: string; right: boolean; points: number }
  revealed: boolean
}) {
  return (
    <div className="flex w-28 flex-col items-center gap-2 text-center">
      <div
        className={cn(
          'relative h-36 w-26 overflow-hidden rounded-md transition-all duration-500',
          answered || revealed ? 'opacity-100' : 'opacity-35 grayscale',
          answered && !revealed && '-translate-y-1 ring-2 ring-primary',
          revealed && result?.right && 'ring-2 ring-match',
          revealed && result && !result.right && 'ring-2 ring-destructive',
        )}
      >
        <img src={cardUrl(partyKey, player.id)} alt="" className="size-full object-cover" />
        {revealed && result && (
          <span
            className={cn(
              'absolute right-1 bottom-1 grid size-7 place-items-center rounded-pill',
              result.right ? 'bg-match text-black' : 'bg-destructive text-white',
            )}
          >
            {result.right ? <Check className="size-4" /> : <X className="size-4" />}
          </span>
        )}
      </div>
      <span className="font-semibold">{player.name}</span>
      {revealed && (
        <span className={cn('line-clamp-2 text-sm', result?.right ? 'text-match' : 'text-muted-foreground')}>
          {result ? (result.right ? `+${result.points}` : result.answer) : '—'}
        </span>
      )}
    </div>
  )
}
