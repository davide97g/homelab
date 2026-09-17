import { useQuery } from '@tanstack/react-query'
import type { Api } from '@jellyfin/sdk'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useSession } from './auth'

/**
 * Whether the bytes behind an item are actually reachable right now.
 *
 * This exists because media on a removable drive can vanish while the server
 * keeps insisting everything is fine. Jellyfin's metadata lives in its own
 * database, so an unplugged disk changes nothing it knows: `/Items` still
 * returns the film, and `PlaybackInfo` still answers 200 with
 * `SupportsDirectPlay: true` and a full MediaSource. Verified against 10.11 --
 * the *only* endpoint that tells the truth is the stream itself, which turns
 * 206 into 404 the moment the file is gone.
 *
 * So: ask for one byte.
 */
export type Availability = 'online' | 'offline'

/**
 * A one-byte range request against the raw file. `mediaSourceId` is optional --
 * the server picks the item's default source -- which is what lets a card with
 * only CARD_FIELDS be probed without refetching MediaSources.
 */
export function probeUrl(api: Api, itemId: string, mediaSourceId?: string): string {
  return api.getUri(`/Videos/${itemId}/stream`, {
    Static: 'true',
    api_key: api.accessToken,
    ...(mediaSourceId ? { mediaSourceId } : {}),
  })
}

export async function probeAvailability(
  api: Api,
  itemId: string,
  mediaSourceId?: string,
): Promise<Availability> {
  const response = await fetch(probeUrl(api, itemId, mediaSourceId), {
    // Not HEAD: only a ranged GET is confirmed to 404 on a missing file, and
    // one byte costs the same as the HEAD would have.
    headers: { Range: 'bytes=0-0' },
    // Without this the whole check is theatre: the browser caches the 206 from
    // the last successful probe and keeps replaying it after the drive is
    // gone. Observed doing exactly that.
    cache: 'no-store',
  })
  if (response.ok || response.status === 206) return 'online'
  if (response.status === 404) return 'offline'
  // 401/403/500 are a server problem, not a storage problem -- do not blame
  // the drive for them.
  throw new Error(`Stream probe failed with ${response.status}`)
}

export const availabilityKey = (itemId: string) => ['availability', itemId] as const

/**
 * Probes one item. Refetches when the tab regains focus, which is what turns
 * "I plugged the drive back in" into a UI that recovers on its own.
 */
export function useAvailability(item: BaseItemDto | undefined, enabled = true) {
  const { api } = useSession()
  const itemId = item?.Id ?? undefined
  const mediaSourceId = item?.MediaSources?.[0]?.Id ?? undefined

  return useQuery({
    queryKey: availabilityKey(itemId ?? ''),
    enabled: enabled && Boolean(itemId),
    queryFn: () => probeAvailability(api, itemId as string, mediaSourceId),
    // Short: the answer is about hardware that can change under us.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
