import { useEffect, useState } from 'react'
import { Copy, Pencil, Plus, Trash2, X } from 'lucide-react'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'
import { QUIZ_TYPE_LABEL, rightAnswer, type QuizQuestion, type QuizType } from './quiz'

type Props = {
  questions: QuizQuestion[]
  /** Where the film is paused: the default moment for a new question. */
  now: number
  /** Open straight onto a new question at `now`, rather than on the list. */
  startWithNew: boolean
  hasDraft: boolean
  hasPublished: boolean
  fileName: string
  onSave: (questions: QuizQuestion[]) => void
  onDiscardDraft: () => void
  onJump: (seconds: number) => void
  onClose: () => void
}

type Editing = { index: number; question: QuizQuestion } | null

const blank = (at: number): QuizQuestion => ({
  at: Math.round(at),
  type: 'choice',
  question: '',
  options: ['', '', '', ''],
  answer: 0,
})

/**
 * Where the questions are written. Changes are saved in this browser as you
 * go; "Copy JSON" hands over the whole quiz, to be committed as the published
 * file so every screen gets it.
 */
export function QuizEditor({
  questions,
  now,
  startWithNew,
  hasDraft,
  hasPublished,
  fileName,
  onSave,
  onDiscardDraft,
  onJump,
  onClose,
}: Props) {
  const [editing, setEditing] = useState<Editing>(startWithNew ? { index: -1, question: blank(now) } : null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyJson = async () => {
    await navigator.clipboard.writeText(`${JSON.stringify({ questions }, null, 2)}\n`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quiz questions"
      className="absolute inset-0 z-40 grid place-items-center bg-black/75 p-4"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-lg bg-surface shadow-panel">
        <div className="flex items-center gap-3 p-5 pb-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {editing ? (editing.index < 0 ? 'New question' : 'Edit question') : 'Quiz questions'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto grid size-9 place-items-center rounded-pill text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {editing ? (
            <QuestionForm
              initial={editing.question}
              onCancel={() => (startWithNew && editing.index < 0 ? onClose() : setEditing(null))}
              onSubmit={(question) => {
                const next = [...questions]
                if (editing.index < 0) next.push(question)
                else next[editing.index] = question
                onSave(next)
                if (startWithNew && editing.index < 0) onClose()
                else setEditing(null)
              }}
            />
          ) : (
            <>
              {questions.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  No questions yet. Pause where you want one and add it.
                </p>
              ) : (
                <ol className="divide-y divide-[var(--hairline)]">
                  {questions.map((q, index) => (
                    <li key={`${q.at}-${index}`} className="flex items-start gap-3 py-3">
                      <button
                        type="button"
                        onClick={() => onJump(q.at)}
                        title="Go to this moment"
                        className="w-16 shrink-0 pt-0.5 text-left font-mono text-xs tabular-nums text-primary hover:underline"
                      >
                        {formatTimecode(q.at)}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{q.question}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {QUIZ_TYPE_LABEL[q.type]} · {q.type === 'text' ? q.accept.join(' / ') : rightAnswer(q)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Edit"
                        onClick={() => setEditing({ index, question: structuredClone(q) })}
                        className="grid size-8 place-items-center rounded-pill text-muted-foreground hover:bg-white/10 hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete"
                        onClick={() => {
                          if (window.confirm('Delete this question?')) onSave(questions.filter((_, i) => i !== index))
                        }}
                        className="grid size-8 place-items-center rounded-pill text-muted-foreground hover:bg-white/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ index: -1, question: blank(now) })}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Plus className="size-4" /> Add at {formatTimecode(now)}
                </button>
                <button
                  type="button"
                  onClick={() => void copyJson()}
                  disabled={questions.length === 0}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-white/10 px-4 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"
                >
                  <Copy className="size-4" /> {copied ? 'Copied' : 'Copy JSON'}
                </button>
                {hasDraft && hasPublished && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Throw away the changes made in this browser?')) onDiscardDraft()
                    }}
                    className="h-9 rounded-md px-4 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  >
                    Discard local changes
                  </button>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {hasDraft
                  ? `Changes are saved in this browser only. To publish them for every screen, copy the JSON into public/quizzes/${fileName}.`
                  : hasPublished
                    ? `Published as public/quizzes/${fileName}.`
                    : 'This film has no quiz yet.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const field =
  'w-full rounded-md bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring'
const label = 'mb-1.5 block text-xs text-muted-foreground'

function QuestionForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: QuizQuestion
  onCancel: () => void
  onSubmit: (question: QuizQuestion) => void
}) {
  const [at, setAt] = useState(formatTimecode(initial.at))
  const [type, setType] = useState<QuizType>(initial.type)
  const [text, setText] = useState(initial.question)
  const [explain, setExplain] = useState(initial.explain ?? '')
  const [options, setOptions] = useState(
    initial.type === 'choice' ? [...initial.options, '', ''].slice(0, Math.max(4, initial.options.length)) : ['', '', '', ''],
  )
  const [answer, setAnswer] = useState(initial.type === 'choice' ? initial.answer : 0)
  const [truth, setTruth] = useState(initial.type === 'truefalse' ? initial.answer : true)
  const [accept, setAccept] = useState(initial.type === 'text' ? initial.accept.join('\n') : '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const seconds = parseTimecode(at)
    if (seconds === null) return setError('Moment must look like 1:23:45, 23:45 or seconds.')
    if (!text.trim()) return setError('Write the question.')
    const base = { at: seconds, question: text.trim(), ...(explain.trim() ? { explain: explain.trim() } : {}) }
    if (type === 'choice') {
      const kept = options.map((o, i) => ({ o: o.trim(), i })).filter(({ o }) => o)
      const right = kept.findIndex(({ i }) => i === answer)
      if (kept.length < 2) return setError('Give at least two options.')
      if (right < 0) return setError('The option marked right is empty.')
      return onSubmit({ ...base, type, options: kept.map(({ o }) => o), answer: right })
    }
    if (type === 'truefalse') return onSubmit({ ...base, type, answer: truth })
    const list = accept.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!list.length) return setError('Give at least one accepted answer.')
    return onSubmit({ ...base, type, accept: list })
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="quiz-at">
            Moment
          </label>
          <input id="quiz-at" value={at} onChange={(e) => setAt(e.target.value)} className={cn(field, 'font-mono')} />
        </div>
        <div>
          <label className={label} htmlFor="quiz-type">
            Kind
          </label>
          <select
            id="quiz-type"
            value={type}
            onChange={(e) => setType(e.target.value as QuizType)}
            className={cn(field, 'h-9 py-0')}
          >
            {(Object.keys(QUIZ_TYPE_LABEL) as QuizType[]).map((t) => (
              <option key={t} value={t}>
                {QUIZ_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="quiz-question-text">
          Question
        </label>
        <textarea
          id="quiz-question-text"
          rows={2}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          className={field}
        />
      </div>

      {type === 'choice' && (
        <fieldset className="grid gap-2">
          <legend className={label}>Options, with the right one ticked</legend>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type="radio"
                name="quiz-right"
                aria-label={`Option ${index + 1} is right`}
                checked={answer === index}
                onChange={() => setAnswer(index)}
                className="size-4 accent-primary"
              />
              <input
                value={option}
                placeholder={`Option ${index + 1}`}
                onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value : o)))}
                className={field}
              />
            </div>
          ))}
        </fieldset>
      )}

      {type === 'truefalse' && (
        <fieldset>
          <legend className={label}>The statement is</legend>
          <div className="flex gap-2">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setTruth(value)}
                className={cn(
                  'h-9 rounded-md px-4 text-sm',
                  truth === value ? 'bg-white/20 font-semibold' : 'bg-surface-2 text-muted-foreground',
                )}
              >
                {value ? 'True' : 'False'}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {type === 'text' && (
        <div>
          <label className={label} htmlFor="quiz-accept">
            Accepted answers, one per line. Case, accents and small typos do not matter.
          </label>
          <textarea id="quiz-accept" rows={3} value={accept} onChange={(e) => setAccept(e.target.value)} className={field} />
        </div>
      )}

      <div>
        <label className={label} htmlFor="quiz-explain">
          Shown after answering (optional)
        </label>
        <input id="quiz-explain" value={explain} onChange={(e) => setExplain(e.target.value)} className={field} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md px-4 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          Cancel
        </button>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Save
        </button>
      </div>
    </form>
  )
}

/** "1:23:45", "23:45" or plain seconds. */
function parseTimecode(value: string): number | null {
  const parts = value.trim().split(':')
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}
