import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { formatRuntime } from '@/lib/jellyfin/ticks'

/** "FILM" / "SERIES" / "EPISODE", the way the reference layout tags a card. */
export function kindLabel(item: BaseItemDto) {
  switch (item.Type) {
    case 'Series':
      return 'Series'
    case 'Episode':
      return 'Episode'
    case 'Movie':
      return 'Film'
    default:
      return item.Type ?? ''
  }
}

/** The title a card shows: an episode belongs to its series. */
export function displayTitle(item: BaseItemDto) {
  return item.Type === 'Episode' ? (item.SeriesName ?? item.Name) : item.Name
}

/** Jellyfin rates 0-10; everyone reads a percentage. */
export function matchPercent(item: BaseItemDto) {
  return item.CommunityRating ? Math.round(item.CommunityRating * 10) : null
}

/** Year, runtime, episode number -- whatever this kind of item actually has. */
export function factLine(item: BaseItemDto) {
  if (item.Type === 'Episode') {
    return [
      item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : null,
      item.IndexNumber != null ? `E${item.IndexNumber}` : null,
      item.Name,
    ].filter(Boolean) as string[]
  }
  return [
    item.ProductionYear ? String(item.ProductionYear) : null,
    item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null,
  ].filter(Boolean) as string[]
}
