/**
 * Quiz night: the film's questions answered by everyone in the room, each on
 * their own phone. The game itself runs on JARVIS (jarvis.davideghiotto.it/quiz);
 * Cinema is the host -- it asks when the film reaches a question and shows who
 * answered and who is winning on the big screen.
 *
 * Party mode turns on by opening Cinema once with `?party=<host key>` (the link
 * comes from JARVIS's /api/quiz/links); the key stays in this browser until
 * `?party=off`.
 */

import { useEffect, useState } from 'react'
import type { QuizQuestion } from './quiz'

export const JARVIS = import.meta.env.VITE_JARVIS_URL ?? 'https://jarvis.davideghiotto.it'
const KEY = 'cinema.quiz.party'

/** Called once at startup: take the key from the URL and clean the address bar. */
export function capturePartyKey() {
  try {
    const url = new URL(window.location.href)
    const value = url.searchParams.get('party')
    if (value === null) return
    if (value === 'off' || value === '') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, value)
    url.searchParams.delete('party')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // blocked storage: party mode simply stays off
  }
}

export function partyKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export type PartyPlayer = {
  id: string
  name: string
  title: string
  joined: boolean
  score: number
  right: number
}

export type PartyResult = { answer: string; right: boolean; points: number; seconds: number }

export type PartyState = {
  current: null | {
    id: string
    number: number
    total: number | null
    phase: 'open' | 'revealed'
    openedAt: number
    question: { type: QuizQuestion['type']; question: string; options?: string[] }
    answered: string[]
    right?: string
    rightIndex?: number | null
    explain?: string | null
    results?: Record<string, PartyResult>
  }
  standings: PartyPlayer[]
  asked: number
}

export const cardUrl = (key: string, id: string) => `${JARVIS}/quiz/card/${id}?k=${encodeURIComponent(key)}`

export async function hostCall(key: string, action: 'ask' | 'reveal' | 'close', body: object = {}) {
  const response = await fetch(`${JARVIS}/quiz/api/host/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Quiz-Key': key },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`JARVIS ${response.status}`)
  return (await response.json()) as PartyState
}

/** Live game state over server-sent events; EventSource reconnects by itself. */
export function usePartyState(key: string | null) {
  const [state, setState] = useState<PartyState | null>(null)
  const [online, setOnline] = useState(true)
  useEffect(() => {
    if (!key) return
    const source = new EventSource(`${JARVIS}/quiz/api/events?k=${encodeURIComponent(key)}`)
    source.onmessage = (event) => {
      setOnline(true)
      setState(JSON.parse(event.data) as PartyState)
    }
    source.onerror = () => setOnline(false)
    return () => source.close()
  }, [key])
  return { state, setState, online }
}
