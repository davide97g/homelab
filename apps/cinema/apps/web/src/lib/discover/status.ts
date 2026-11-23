import { MediaStatus, RequestStatus, type MediaInfo } from './types'

/** Where a title stands for the person looking at it, in the words the UI uses. */
export type Standing = 'available' | 'partial' | 'processing' | 'pending' | 'blocked' | 'none'

export function standingOf(info: MediaInfo | undefined | null): Standing {
  switch (info?.status) {
    case MediaStatus.Available:
      return 'available'
    case MediaStatus.PartiallyAvailable:
      return 'partial'
    case MediaStatus.Processing:
      return 'processing'
    case MediaStatus.Pending:
      return 'pending'
    case MediaStatus.Blocklisted:
      return 'blocked'
    default:
      return 'none'
  }
}

export const STANDING_LABEL: Record<Standing, string | null> = {
  available: 'In library',
  partial: 'Partly in library',
  processing: 'Downloading',
  pending: 'Awaiting approval',
  blocked: 'Unavailable',
  none: null,
}

export type SeasonStanding = 'available' | 'processing' | 'pending'

/**
 * Per season, what is already on its way or there. A season counts as taken if
 * the media says so or if a live request (pending or approved) names it; only
 * the rest can still be asked for.
 */
export function seasonStandings(info: MediaInfo | undefined | null) {
  const out = new Map<number, SeasonStanding>()
  for (const s of info?.seasons ?? []) {
    if (s.status === MediaStatus.Available || s.status === MediaStatus.PartiallyAvailable) out.set(s.seasonNumber, 'available')
    else if (s.status === MediaStatus.Processing) out.set(s.seasonNumber, 'processing')
    else if (s.status === MediaStatus.Pending) out.set(s.seasonNumber, 'pending')
  }
  for (const r of info?.requests ?? []) {
    const live = r.status === RequestStatus.Pending ? 'pending' : r.status === RequestStatus.Approved ? 'processing' : null
    if (!live) continue
    for (const s of r.seasons ?? []) if (!out.has(s.seasonNumber)) out.set(s.seasonNumber, live)
  }
  return out
}
