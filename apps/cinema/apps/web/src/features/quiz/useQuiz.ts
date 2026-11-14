import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseQuiz, type Quiz, type QuizQuestion } from './quiz'

const ENABLED_KEY = 'cinema.quiz.enabled'
const draftKey = (key: string) => `cinema.quiz.draft.${key}`

function readStorage(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}
function writeStorage(name: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    // Private mode or blocked storage: the quiz still works, it just forgets.
  }
}

/**
 * The quiz for one film: the published file, overlaid by this browser's draft
 * if there is one. A missing file is not an error, it is a film with no quiz
 * yet -- the editor can still start one.
 */
export function useQuiz(key: string | null) {
  const published = useQuery({
    queryKey: ['quiz', key],
    enabled: Boolean(key),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<Quiz | null> => {
      const response = await fetch(`/quizzes/${key}.json`, { cache: 'no-cache' })
      // Vite and nginx both answer an unknown path with index.html, so a 200
      // that is not JSON means "no quiz" too.
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null
      return parseQuiz(await response.json())
    },
  })

  const [draft, setDraft] = useState<Quiz | null>(null)
  useEffect(() => {
    if (!key) return setDraft(null)
    const raw = readStorage(draftKey(key))
    try {
      setDraft(raw ? parseQuiz(JSON.parse(raw)) : null)
    } catch {
      setDraft(null)
    }
  }, [key])

  const quiz = draft ?? published.data ?? null

  const saveQuestions = useCallback(
    (questions: QuizQuestion[]) => {
      if (!key) return
      const next = parseQuiz({ ...(quiz ?? {}), questions })
      writeStorage(draftKey(key), JSON.stringify(next))
      setDraft(next)
    },
    [key, quiz],
  )

  const discardDraft = useCallback(() => {
    if (!key) return
    writeStorage(draftKey(key), null)
    setDraft(null)
  }, [key])

  return {
    quiz,
    loading: published.isLoading,
    hasDraft: draft !== null,
    hasPublished: Boolean(published.data),
    saveQuestions,
    discardDraft,
  }
}

/** On or off, remembered across films: a quiz night is a quiz night. */
export function useQuizEnabled() {
  const [enabled, setEnabled] = useState(() => readStorage(ENABLED_KEY) === 'on')
  const set = useCallback((on: boolean) => {
    writeStorage(ENABLED_KEY, on ? 'on' : 'off')
    setEnabled(on)
  }, [])
  return [enabled, set] as const
}

/**
 * Stops the film when playback runs across a question that has not been
 * answered. Only a crossing counts: dragging the scrub bar past a question does
 * not ask it, so you can skip ahead without a pop-up for every one you jumped.
 */
export function useQuizTrigger({
  videoRef,
  questions,
  answered,
  active,
  onReach,
  media,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  questions: QuizQuestion[]
  answered: Record<number, boolean>
  /** False while the quiz is off or a card is already up. */
  active: boolean
  onReach: (index: number) => void
  /** Changes when a new <video> source is attached, so the listeners follow it. */
  media: unknown
}) {
  const last = useRef(0)
  const latest = useRef({ questions, answered, active, onReach })
  latest.current = { questions, answered, active, onReach }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    last.current = video.currentTime

    const onTime = () => {
      const now = video.currentTime
      const before = last.current
      last.current = now
      const { questions, answered, active, onReach } = latest.current
      // A real crossing advances by a fraction of a second per event; a jump
      // of more than a couple of seconds is a seek that slipped past `seeking`.
      if (!active || video.seeking || video.paused || now <= before || now - before > 2) return
      const index = questions.findIndex((q, i) => !(i in answered) && q.at > before && q.at <= now)
      if (index >= 0) {
        video.pause()
        onReach(index)
      }
    }
    const onSeeked = () => {
      last.current = video.currentTime
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onSeeked)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [videoRef, media])
}
