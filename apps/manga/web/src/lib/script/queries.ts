import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, HttpError } from '@/lib/kavita/client'
import type { Script, SearchHit } from './types'

// The scripts service (transcribe/serve.py), on our own origin at /script.
const BASE = '/script'

export const scriptKeys = {
  chapter: (id: number) => ['script', 'chapter', id] as const,
  search: (q: string) => ['script', 'search', q] as const,
}

/** A chapter's script, or null when it has none yet (the service answers 404). */
export function useChapterScript(chapterId: number) {
  return useQuery({
    queryKey: scriptKeys.chapter(chapterId),
    queryFn: () =>
      api<Script>(`/chapter/${chapterId}`, { base: BASE }).catch((e) => {
        if (e instanceof HttpError && e.status === 404) return null
        throw e
      }),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useScriptSearch(q: string) {
  const query = q.trim()
  return useQuery({
    queryKey: scriptKeys.search(query),
    queryFn: () => api<{ q: string; results: SearchHit[] }>('/search', { base: BASE, query: { q: query } }),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    select: (d) => d.results,
  })
}
