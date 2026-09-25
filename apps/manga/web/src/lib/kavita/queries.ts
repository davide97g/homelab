import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Chapter, ChapterInfo, Progress, Series, SeriesDetail, SeriesMetadata } from './types'

export const queryKeys = {
  library: ['library'] as const,
  onDeck: ['on-deck'] as const,
  series: (id: number) => ['series', id] as const,
  detail: (id: number) => ['series', id, 'detail'] as const,
  metadata: (id: number) => ['series', id, 'metadata'] as const,
  chapterInfo: (id: number) => ['chapter', id, 'info'] as const,
  progress: (id: number) => ['chapter', id, 'progress'] as const,
}

// An empty And-filter is "every series this user can see".
const ALL = { statements: [], combination: 1, limitTo: 0 }

export const fetchLibrary = () =>
  api<Series[]>('/series/all-v2', { body: ALL, query: { PageNumber: 1, PageSize: 0 } })

export function useLibrary() {
  return useQuery({
    queryKey: queryKeys.library,
    queryFn: fetchLibrary,
    select: (all) =>
      [...all].sort((a, b) => (a.sortName ?? a.name).localeCompare(b.sortName ?? b.name)),
  })
}

export function useOnDeck() {
  return useQuery({
    queryKey: queryKeys.onDeck,
    queryFn: () =>
      api<Series[]>('/series/on-deck', { method: 'POST', query: { PageNumber: 1, PageSize: 12 } }),
  })
}

export function useSeries(id: number) {
  return useQuery({ queryKey: queryKeys.series(id), queryFn: () => api<Series>(`/series/${id}`) })
}

export function useSeriesDetail(id: number) {
  return useQuery({
    queryKey: queryKeys.detail(id),
    queryFn: () => api<SeriesDetail>('/series/series-detail', { query: { seriesId: id } }),
    select: readingOrder,
  })
}

export function useSeriesMetadata(id: number) {
  return useQuery({
    queryKey: queryKeys.metadata(id),
    queryFn: () => api<SeriesMetadata>('/series/metadata', { query: { seriesId: id } }),
  })
}

export function useChapterInfo(id: number) {
  return useQuery({
    queryKey: queryKeys.chapterInfo(id),
    queryFn: () => api<ChapterInfo>('/reader/chapter-info', { query: { chapterId: id } }),
    staleTime: Infinity,
  })
}

export function useChapterProgress(id: number) {
  return useQuery({
    queryKey: queryKeys.progress(id),
    queryFn: () => api<Progress | null>('/reader/get-progress', { query: { chapterId: id } }),
    staleTime: 0,
    gcTime: 0,
  })
}

export const saveProgress = (p: Progress) => api<void>('/reader/progress', { body: p })

export const adjacentChapter = (dir: 'next' | 'prev', seriesId: number, volumeId: number, chapterId: number) =>
  api<number>(`/reader/${dir}-chapter`, {
    query: { seriesId, volumeId, currentChapterId: chapterId },
  })

// Kavita answers "where to continue" with the earliest unread chapter. When
// something is half-read, the one touched most recently is the better answer.
export function resumeChapter(chapters: Chapter[]): Chapter | undefined {
  const started = chapters
    .filter((c) => c.pagesRead > 0 && c.pagesRead < c.pages)
    .sort((a, b) => b.lastReadingProgressUtc.localeCompare(a.lastReadingProgressUtc))
  return started[0] ?? chapters.find((c) => c.pagesRead < c.pages) ?? chapters[0]
}

// Manga libraries list every chapter in `chapters`; volumes and specials are
// the other two places one can hide. One flat list, in reading order.
function readingOrder(d: SeriesDetail): Chapter[] {
  const seen = new Map<number, Chapter>()
  for (const c of [...d.chapters, ...d.volumes.flatMap((v) => v.chapters)]) seen.set(c.id, c)
  const main = [...seen.values()].sort((a, b) => a.minNumber - b.minNumber || a.sortOrder - b.sortOrder)
  const specials = d.specials.filter((c) => !seen.has(c.id))
  return [...main, ...specials]
}

export function useScanLibrary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const startedAt = new Date().toISOString()
      const before = new Map((await fetchLibrary()).map((s) => [s.id, s.pages]))
      await api<void>('/library/scan-all', { method: 'POST' })

      // The scan runs in the background. Poll until the shelf stops changing,
      // or give up after ~40s with whatever it found.
      let last = ''
      let stable = 0
      let latest: Series[] = []
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 2500))
        latest = await fetchLibrary()
        const sig = latest.map((s) => `${s.id}:${s.pages}`).join(',')
        const changed = latest.some((s) => before.get(s.id) !== s.pages)
        stable = sig === last ? stable + 1 : 0
        last = sig
        if ((changed && stable >= 1) || (!changed && i >= 3)) break
      }
      qc.setQueryData(queryKeys.library, latest)
      await qc.invalidateQueries()
      return latest.filter((s) => before.get(s.id) !== s.pages || s.lastChapterAddedUtc > startedAt)
    },
  })
}
