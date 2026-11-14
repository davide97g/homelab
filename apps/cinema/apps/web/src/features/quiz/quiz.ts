/**
 * Film quizzes: questions pinned to moments of a film. When the quiz is on, the
 * player stops at each one, asks it, and says whether the answer was right.
 *
 * A quiz is a static JSON file in `public/quizzes/`, named after the film's
 * TMDB id rather than its Jellyfin id: a Jellyfin id is minted per server and
 * changed the last time the NAS was reinstalled; a TMDB id never changes.
 * Edits made in the player stay in this browser as a draft until exported and
 * committed over the file.
 */

export type QuizQuestion =
  | { at: number; type: 'choice'; question: string; options: string[]; answer: number; explain?: string }
  | { at: number; type: 'truefalse'; question: string; answer: boolean; explain?: string }
  | { at: number; type: 'text'; question: string; accept: string[]; explain?: string }

export type QuizType = QuizQuestion['type']

export type Quiz = {
  title?: string
  /** Seconds into the film, sorted ascending. */
  questions: QuizQuestion[]
}

export const QUIZ_TYPE_LABEL: Record<QuizType, string> = {
  choice: 'Multiple choice',
  truefalse: 'True or false',
  text: 'Free answer',
}

/** The film's stable name for its quiz file, or null when it has none. */
export function quizKey(providerIds: Record<string, string | null> | null | undefined, itemId?: string) {
  const tmdb = providerIds?.Tmdb
  if (tmdb) return `tmdb-${tmdb}`
  const imdb = providerIds?.Imdb
  if (imdb) return `imdb-${imdb}`
  return itemId ? `item-${itemId}` : null
}

export const sortQuestions = (questions: QuizQuestion[]) => [...questions].sort((a, b) => a.at - b.at)

/** What the right answer looks like, for the verdict and the editor list. */
export function rightAnswer(q: QuizQuestion): string {
  if (q.type === 'choice') return q.options[q.answer] ?? ''
  if (q.type === 'truefalse') return q.answer ? 'True' : 'False'
  return q.accept[0] ?? ''
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * A free answer counts when it matches an accepted one, ignoring case, accents
 * and punctuation, with one typo forgiven per six letters: "giaponese" is
 * still the Japanese golfer.
 */
export function freeAnswerIsRight(given: string, accept: string[]) {
  const g = normalise(given)
  if (!g) return false
  return accept.some((a) => {
    const n = normalise(a)
    return distance(g, n) <= Math.floor(n.length / 6)
  })
}

/** Loose check of a file or a paste, so a typo in JSON fails loudly, not mid-film. */
export function parseQuiz(raw: unknown): Quiz {
  const data = raw as Partial<Quiz> | null
  if (!data || !Array.isArray(data.questions)) throw new Error('A quiz needs a "questions" list.')
  // Checked field by field, so read loosely: the file has not earned its type yet.
  for (const q of data.questions as Array<Record<string, unknown> | null>) {
    if (!q || typeof q.at !== 'number' || typeof q.question !== 'string') {
      throw new Error('Every question needs "at" (seconds) and "question".')
    }
    if (q.type === 'choice' && !(Array.isArray(q.options) && typeof q.answer === 'number')) {
      throw new Error(`"${q.question}": a multiple choice needs "options" and "answer".`)
    }
    if (q.type === 'truefalse' && typeof q.answer !== 'boolean') {
      throw new Error(`"${q.question}": true or false needs "answer": true|false.`)
    }
    if (q.type === 'text' && !Array.isArray(q.accept)) {
      throw new Error(`"${q.question}": a free answer needs "accept".`)
    }
  }
  return { ...data, questions: sortQuestions(data.questions) }
}
