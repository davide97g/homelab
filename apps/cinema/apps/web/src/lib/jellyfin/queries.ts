import { useQuery } from '@tanstack/react-query'
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api'
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api'
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api'
import { getTvShowsApi } from '@jellyfin/sdk/lib/utils/api/tv-shows-api'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useSession } from './auth'

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
