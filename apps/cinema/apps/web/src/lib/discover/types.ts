/**
 * The parts of Seerr's API that Discover reads, as accounts relays them
 * (apps/accounts, /api/discover). Seerr answers in the server's locale, Italian.
 */

export type MediaType = 'movie' | 'tv'

/** Seerr's MediaStatus: where a title stands in the pipeline. */
export const MediaStatus = {
  Unknown: 1,
  Pending: 2,
  Processing: 3,
  PartiallyAvailable: 4,
  Available: 5,
  Blocklisted: 6,
  Deleted: 7,
} as const

/** Seerr's MediaRequestStatus. */
export const RequestStatus = {
  Pending: 1,
  Approved: 2,
  Declined: 3,
  Failed: 4,
  Completed: 5,
} as const

export type SeasonStatus = { seasonNumber: number; status: number }

export type MediaRequest = {
  id: number
  status: number
  type: MediaType
  createdAt: string
  seasons?: SeasonStatus[]
  media?: MediaInfo
  requestedBy?: { id: number; displayName: string }
}

export type MediaInfo = {
  id: number
  tmdbId: number
  mediaType: MediaType
  status: number
  /** The NAS Jellyfin's item id once it is there: Discover links straight to it. */
  jellyfinMediaId: string | null
  seasons?: SeasonStatus[]
  requests?: MediaRequest[]
}

/** A card in a row or a search result. */
export type DiscoverResult = {
  id: number
  mediaType: MediaType | 'person'
  title?: string
  name?: string
  releaseDate?: string
  firstAirDate?: string
  posterPath?: string | null
  backdropPath?: string | null
  overview?: string
  voteAverage?: number
  mediaInfo?: MediaInfo
}

export type Page<T> = { page: number; totalPages: number; totalResults: number; results: T[] }

export type CastMember = { id: number; name: string; character?: string; profilePath?: string | null }

type DetailsBase = {
  id: number
  overview?: string
  tagline?: string
  posterPath?: string | null
  backdropPath?: string | null
  voteAverage?: number
  genres: { id: number; name: string }[]
  credits?: { cast: CastMember[] }
  mediaInfo?: MediaInfo
}

export type MovieDetails = DetailsBase & {
  mediaType: 'movie'
  title: string
  releaseDate?: string
  runtime?: number
}

export type TvSeason = {
  id: number
  seasonNumber: number
  name: string
  episodeCount: number
  airDate?: string | null
}

export type TvDetails = DetailsBase & {
  mediaType: 'tv'
  name: string
  firstAirDate?: string
  numberOfSeasons: number
  seasons: TvSeason[]
}

export type Details = MovieDetails | TvDetails

export type DiscoverMe = {
  id: number
  displayName: string
  canRequest: Record<MediaType, boolean>
  autoApprove: Record<MediaType, boolean>
}

/**
 * Between the download and the NAS, from the mini PC's report (accounts'
 * /api/discover/progress). Stages in pipeline order; "stalled" is a download
 * or import that needs a hand.
 */
export type PipelineStage =
  | 'queued'
  | 'downloading'
  | 'stalled'
  | 'importing'
  | 'settling'
  | 'waiting'
  | 'sending'
  | 'verifying'
  | 'arrived'

export type TitleProgress = {
  title: string | null
  stage: PipelineStage
  message: string | null
  download: { size: number; left: number; eta: string | null; state: PipelineStage } | null
  transfer: { bytes: number; total: number; startsAt: string | null; eta: string | null; paused: boolean } | null
  /** When it should be watchable on the NAS. */
  eta: string | null
  files: number
  filesArrived: number
  arrivedAt: string | null
}

export type ProgressReply = {
  available: boolean
  at: string | null
  stale: boolean
  sync: { enabled: boolean; note: string; rateBps: number; measured: boolean } | null
  titles: Record<string, TitleProgress>
}

export const progressKey = (type: MediaType, tmdbId: number) => `${type}:${tmdbId}`
