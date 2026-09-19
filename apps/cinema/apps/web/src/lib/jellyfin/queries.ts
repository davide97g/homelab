import { useQuery } from '@tanstack/react-query'
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api'
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api'
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api'
import { getTvShowsApi } from '@jellyfin/sdk/lib/utils/api/tv-shows-api'
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useSession } from './auth'
import { getDeviceId } from './client'
import { userImageUrl } from './images'
import { ticksToSeconds } from './ticks'

/** Everything the detail page and player need in one round trip. */
export const DETAIL_FIELDS = [
  ItemFields.Overview,
  ItemFields.Genres,
  ItemFields.Taglines,
  ItemFields.People,
  ItemFields.MediaSources,
  ItemFields.MediaStreams,
  ItemFields.Chapters,
] as const

/** Cards only need enough to render art + a progress bar. */
export const CARD_FIELDS = [ItemFields.Overview, ItemFields.Genres] as const

export const queryKeys = {
  views: (userId: string) => ['views', userId] as const,
  resume: (userId: string) => ['resume', userId] as const,
  latest: (userId: string, parentId?: string) => ['latest', userId, parentId ?? null] as const,
  nextUp: (userId: string) => ['nextUp', userId] as const,
  items: (userId: string, params: unknown) => ['items', userId, params] as const,
  suggestions: (userId: string) => ['suggestions', userId] as const,
  item: (userId: string, itemId: string) => ['item', userId, itemId] as const,
  viewers: () => ['viewers'] as const,
}

/** Top-level libraries, i.e. the folders you configured on the server. */
export function useUserViews() {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.views(userId),
    queryFn: async () => {
      const { data } = await getUserViewsApi(api).getUserViews({ userId })
      return data.Items ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** "Continue Watching" -- partially played items, most recent first. */
export function useResumeItems(limit = 12) {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.resume(userId),
    queryFn: async () => {
      const { data } = await getItemsApi(api).getResumeItems({
        userId,
        limit,
        fields: [...CARD_FIELDS],
        mediaTypes: ['Video'],
        enableTotalRecordCount: false,
      })
      return data.Items ?? []
    },
  })
}

/** "Recently Added". Pass a view id to scope it to one library. */
export function useLatestItems(parentId?: string, limit = 16) {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.latest(userId, parentId),
    queryFn: async () => {
      const { data } = await getUserLibraryApi(api).getLatestMedia({
        userId,
        parentId,
        limit,
        fields: [...CARD_FIELDS],
      })
      return data ?? []
    },
  })
}

/** Next unwatched episode per series. */
export function useNextUp(limit = 12) {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.nextUp(userId),
    queryFn: async () => {
      const { data } = await getTvShowsApi(api).getNextUp({
        userId,
        limit,
        fields: [...CARD_FIELDS],
      })
      return data.Items ?? []
    },
  })
}

/**
 * Something to watch, drawn at random from the whole library.
 *
 * "Recently added" is a poor recommender on a library that was imported in one
 * go -- every film shares a date, and Jellyfin's own latest-media endpoint
 * collapses and filters it further. Random over everything always has
 * something to show, which is the job of the home screen.
 */
export function useSuggestions(limit = 12) {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.suggestions(userId),
    queryFn: async () => {
      const { data } = await getItemsApi(api).getItems({
        userId,
        recursive: true,
        fields: [...CARD_FIELDS],
        includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
        sortBy: [ItemSortBy.Random],
        limit,
        enableTotalRecordCount: false,
      })
      return data.Items ?? []
    },
    // Random, so re-running it on a refocus would reshuffle the page under
    // the reader. One draw per session is the point.
    staleTime: Infinity,
  })
}

export type ItemsQueryParams = {
  parentId?: string
  includeItemTypes?: BaseItemKind[]
  sortBy?: ItemSortBy[]
  sortOrder?: SortOrder[]
  searchTerm?: string
  limit?: number
  startIndex?: number
}

/** The workhorse: paged, sorted, filtered library browsing. */
export function useItems(params: ItemsQueryParams, enabled = true) {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.items(userId, params),
    enabled,
    queryFn: async () => {
      const { data } = await getItemsApi(api).getItems({
        userId,
        recursive: true,
        fields: [...CARD_FIELDS],
        includeItemTypes: params.includeItemTypes ?? [BaseItemKind.Movie],
        sortBy: params.sortBy ?? [ItemSortBy.SortName],
        sortOrder: params.sortOrder ?? [SortOrder.Ascending],
        parentId: params.parentId,
        searchTerm: params.searchTerm,
        limit: params.limit ?? 100,
        startIndex: params.startIndex,
      })
      return {
        items: data.Items ?? [],
        totalRecordCount: data.TotalRecordCount ?? 0,
      }
    },
  })
}

/** Full detail for one item, including media sources. */
export function useItem(itemId: string | undefined) {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.item(userId, itemId ?? ''),
    enabled: Boolean(itemId),
    queryFn: async (): Promise<BaseItemDto> => {
      const { data } = await getUserLibraryApi(api).getItem({
        userId,
        itemId: itemId as string,
      })
      return data
    },
  })
}

/** One person, one screen, one thing playing on it. */
export type Viewer = {
  sessionId: string
  userName: string
  avatarUrl?: string
  /** Chrome, Cinema for iOS, Findroid -- what they are watching it in. */
  client: string
  item: BaseItemDto
  positionSeconds: number
  runtimeSeconds: number
  isPaused: boolean
  /** The session belonging to this browser, so the list can say so. */
  isThisDevice: boolean
}

/**
 * Who is watching what, right now, across every client on the server.
 *
 * `GET /Sessions` returns idle sessions too -- a signed-in phone sitting on the
 * home screen is a session -- so only the ones with a `NowPlayingItem` count as
 * a viewer. `activeWithinSeconds` drops the ones the server has not heard from:
 * a client that dies without reporting `/Stopped` otherwise lingers for its
 * full timeout and inflates the count.
 *
 * Jellyfin only shows other people's sessions to an administrator; everyone
 * else gets their own, or a 403. That is a legitimate answer, not a bug, so the
 * query does not retry and the caller renders nothing when it fails.
 */
export function useActiveViewers() {
  const { api, userId } = useSession()
  return useQuery({
    queryKey: queryKeys.viewers(),
    queryFn: async (): Promise<Viewer[]> => {
      const { data } = await getSessionApi(api).getSessions({ activeWithinSeconds: 90 })
      const thisDevice = getDeviceId()
      return (data ?? [])
        .filter((session) => session.NowPlayingItem)
        .map((session) => ({
          sessionId: session.Id ?? `${session.UserId}-${session.DeviceId}`,
          userName: session.UserName ?? 'Someone',
          avatarUrl: userImageUrl(api, session.UserId, session.UserPrimaryImageTag),
          client: session.Client ?? session.DeviceName ?? '',
          item: session.NowPlayingItem as BaseItemDto,
          positionSeconds: ticksToSeconds(session.PlayState?.PositionTicks),
          runtimeSeconds: ticksToSeconds(session.NowPlayingItem?.RunTimeTicks),
          isPaused: Boolean(session.PlayState?.IsPaused),
          isThisDevice: session.DeviceId === thisDevice && session.UserId === userId,
        }))
    },
    // The position moves whether or not anything else does, so this is the one
    // query in the app that polls. Ten seconds matches the player's own
    // progress reporting -- asking faster only re-reads the same number.
    refetchInterval: 10_000,
    retry: false,
  })
}
