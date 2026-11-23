import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../jellyfin/auth'
import { discoverFetch } from './client'
import type { Details, DiscoverMe, DiscoverResult, MediaRequest, MediaType, Page } from './types'

export const discoverKeys = {
  all: (userId: string) => ['discover', userId] as const,
  me: (userId: string) => ['discover', userId, 'me'] as const,
  row: (userId: string, row: string) => ['discover', userId, 'row', row] as const,
  search: (userId: string, term: string) => ['discover', userId, 'search', term] as const,
  details: (userId: string, type: MediaType, id: number) => ['discover', userId, 'details', type, id] as const,
  related: (userId: string, type: MediaType, id: number) => ['discover', userId, 'related', type, id] as const,
  requests: (userId: string) => ['discover', userId, 'requests'] as const,
}

/** The Jellyfin token is the whole credential: accounts maps it to Seerr. */
function useToken() {
  const { api, userId } = useAuth()
  return { token: api.accessToken, userId: userId ?? '' }
}

export function useDiscoverMe() {
  const { token, userId } = useToken()
  return useQuery({
    queryKey: discoverKeys.me(userId),
    queryFn: () => discoverFetch<DiscoverMe>(token, 'me'),
    enabled: Boolean(token),
    staleTime: 10 * 60_000,
  })
}

export type DiscoverRowId = 'trending' | 'movies' | 'tv' | 'movies/upcoming' | 'tv/upcoming'

const onlyTitles = (results: DiscoverResult[]) => results.filter((r) => r.mediaType === 'movie' || r.mediaType === 'tv')

/** Seerr's rows don't always say what they hold; the path does. */
function withType(row: DiscoverRowId, results: DiscoverResult[]) {
  const type: MediaType | null = row.startsWith('movies') ? 'movie' : row.startsWith('tv') ? 'tv' : null
  return onlyTitles(type ? results.map((r) => ({ ...r, mediaType: r.mediaType ?? type })) : results)
}

export function useDiscoverRow(row: DiscoverRowId) {
  const { token, userId } = useToken()
  return useQuery({
    queryKey: discoverKeys.row(userId, row),
    queryFn: async () => withType(row, (await discoverFetch<Page<DiscoverResult>>(token, `discover/${row}?page=1`)).results),
    enabled: Boolean(token),
    staleTime: 10 * 60_000,
  })
}

export function useDiscoverSearch(term: string) {
  const { token, userId } = useToken()
  return useQuery({
    queryKey: discoverKeys.search(userId, term),
    queryFn: async () =>
      onlyTitles((await discoverFetch<Page<DiscoverResult>>(token, `search?query=${encodeURIComponent(term)}&page=1`)).results),
    enabled: Boolean(token) && term.length > 1,
    staleTime: 5 * 60_000,
  })
}

export function useDiscoverDetails(type: MediaType | undefined, id: number | undefined) {
  const { token, userId } = useToken()
  return useQuery({
    queryKey: discoverKeys.details(userId, type ?? 'movie', id ?? 0),
    queryFn: async () => ({ ...(await discoverFetch<Details>(token, `${type}/${id}`)), mediaType: type }) as Details,
    enabled: Boolean(token && type && id),
  })
}

export function useDiscoverRecommendations(type: MediaType | undefined, id: number | undefined) {
  const { token, userId } = useToken()
  return useQuery({
    queryKey: discoverKeys.related(userId, type ?? 'movie', id ?? 0),
    queryFn: async () =>
      (await discoverFetch<Page<DiscoverResult>>(token, `${type}/${id}/recommendations?page=1`)).results.map((r) => ({
        ...r,
        mediaType: r.mediaType ?? type,
      })) as DiscoverResult[],
    enabled: Boolean(token && type && id),
    staleTime: 10 * 60_000,
  })
}

/** Your own requests, newest first. accounts pins the list to you. */
export function useMyRequests() {
  const { token, userId } = useToken()
  return useQuery({
    queryKey: discoverKeys.requests(userId),
    queryFn: async () =>
      (await discoverFetch<{ results: MediaRequest[] }>(token, 'request?take=20&skip=0&sort=added&filter=all')).results,
    enabled: Boolean(token),
  })
}

export type RequestInput = { mediaType: MediaType; mediaId: number; seasons?: number[] }

export function useRequestTitle() {
  const { token, userId } = useToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RequestInput) =>
      discoverFetch<MediaRequest>(token, 'request', { method: 'POST', body: JSON.stringify(input) }),
    // A request changes the badge on every card that shows the title.
    onSettled: () => queryClient.invalidateQueries({ queryKey: discoverKeys.all(userId) }),
  })
}

export function useCancelRequest() {
  const { token, userId } = useToken()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: number) => discoverFetch<void>(token, `request/${requestId}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: discoverKeys.all(userId) }),
  })
}
