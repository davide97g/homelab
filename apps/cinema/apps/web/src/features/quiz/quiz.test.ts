import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { freeAnswerIsRight, parseQuiz, quizKey } from './quiz'

describe('freeAnswerIsRight', () => {
  const golfer = ['golfista giapponese', 'golfista']
  test('ignores case, accents and punctuation', () => {
    expect(freeAnswerIsRight('  Golfista GIAPPONESE! ', golfer)).toBe(true)
    expect(freeAnswerIsRight('Perché', ['perche'])).toBe(true)
  })
  test('forgives one typo per six letters', () => {
    expect(freeAnswerIsRight('golfista giaponese', golfer)).toBe(true)
    expect(freeAnswerIsRight('ford angla', ['ford anglia'])).toBe(true)
  })
  test('does not forgive a different answer', () => {
    expect(freeAnswerIsRight('tennista', golfer)).toBe(false)
    expect(freeAnswerIsRight('', golfer)).toBe(false)
    // Short answers get no typo allowance at all.
    expect(freeAnswerIsRight('rom', ['ron'])).toBe(false)
  })
})

describe('parseQuiz', () => {
  test('sorts questions by moment', () => {
    const quiz = parseQuiz({
      questions: [
        { at: 20, type: 'truefalse', question: 'b', answer: true },
        { at: 10, type: 'text', question: 'a', accept: ['x'] },
      ],
    })
    expect(quiz.questions.map((q) => q.at)).toEqual([10, 20])
  })
  test('rejects a malformed question', () => {
    expect(() => parseQuiz({ questions: [{ at: 1, type: 'choice', question: 'q' }] })).toThrow()
    expect(() => parseQuiz({})).toThrow()
  })
  test('every published quiz file parses', () => {
    const dir = new URL('../../../public/quizzes/', import.meta.url)
    for (const name of ['tmdb-672.json']) {
      expect(() => parseQuiz(JSON.parse(readFileSync(new URL(name, dir), 'utf8')))).not.toThrow()
    }
  })
})

test('quizKey prefers TMDB, then IMDb, then the Jellyfin id', () => {
  expect(quizKey({ Tmdb: '672', Imdb: 'tt0295297' }, 'abc')).toBe('tmdb-672')
  expect(quizKey({ Imdb: 'tt0295297' }, 'abc')).toBe('imdb-tt0295297')
  expect(quizKey(null, 'abc')).toBe('item-abc')
  expect(quizKey(null)).toBeNull()
})
