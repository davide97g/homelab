// Hand-written subset of Immich v3.4.0 DTOs (spec/immich-openapi-v3.4.0.json).
// Only the fields this client reads are typed.

export type AssetVisibility = 'archive' | 'timeline' | 'hidden' | 'locked'
export type AssetType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER'
export type AssetOrder = 'asc' | 'desc'
export type AssetMediaSize = 'original' | 'fullsize' | 'preview' | 'thumbnail'

export interface LoginResponseDto {
  accessToken: string
  userId: string
  userEmail: string
  name: string
  isAdmin: boolean
  isOnboarded: boolean
  profileImagePath: string
  shouldChangePassword: boolean
}

export interface UserAdminResponseDto {
  id: string
  email: string
  name: string
  isAdmin: boolean
  profileImagePath: string
  avatarColor: string
}

export interface ServerVersionResponseDto {
  major: number
  minor: number
  patch: number
  prerelease: number | null
  featureLevel: number
}

export interface TimeBucketsResponseDto {
  timeBucket: string
  count: number
}

/** Columnar month payload: every array is indexed by asset. */
export interface TimeBucketAssetResponseDto {
  id: string[]
  ownerId: string[]
  ratio: number[]
  thumbhash: (string | null)[]
  fileCreatedAt: string[]
  createdAt: string[]
  localOffsetHours: number[]
  isImage: boolean[]
  isFavorite: boolean[]
  isTrashed: boolean[]
  duration: (number | null)[]
  livePhotoVideoId: (string | null)[]
  projectionType: (string | null)[]
  visibility: AssetVisibility[]
  city?: (string | null)[]
  country?: (string | null)[]
  latitude?: (number | null)[]
  longitude?: (number | null)[]
  stack?: (string[] | null)[]
}

export interface ExifResponseDto {
  city?: string | null
  state?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  dateTimeOriginal?: string | null
  description?: string | null
  exifImageWidth?: number | null
  exifImageHeight?: number | null
  exposureTime?: string | null
  fNumber?: number | null
  focalLength?: number | null
  iso?: number | null
  fileSizeInByte?: number | null
  make?: string | null
  model?: string | null
  lensModel?: string | null
  timeZone?: string | null
}

export interface PersonResponseDto {
  id: string
  name: string
  birthDate: string | null
  isHidden: boolean
  isFavorite?: boolean
  thumbnailPath: string
  updatedAt?: string
}

export interface PeopleResponseDto {
  total: number
  hidden: number
  hasNextPage?: boolean
  people: PersonResponseDto[]
}

export interface AssetResponseDto {
  id: string
  type: AssetType
  checksum: string
  thumbhash: string | null
  originalFileName: string
  originalMimeType?: string
  fileCreatedAt: string
  fileModifiedAt: string
  localDateTime: string
  createdAt: string
  /** "H:MM:SS.ffffff" string in v3 */
  duration: string | null
  width: number | null
  height: number | null
  isFavorite: boolean
  isArchived: boolean
  isTrashed: boolean
  isOffline: boolean
  livePhotoVideoId?: string | null
  visibility: AssetVisibility
  exifInfo?: ExifResponseDto
  people?: PersonResponseDto[]
}

export interface AlbumResponseDto {
  id: string
  albumName: string
  description: string
  albumThumbnailAssetId: string | null
  assetCount: number
  shared: boolean
  startDate?: string
  endDate?: string
  createdAt: string
  updatedAt: string
  order?: AssetOrder
}

export interface MemoryResponseDto {
  id: string
  type: 'on_this_day' | 'birthday'
  data: { year: number; personId?: string; personName?: string }
  assets: AssetResponseDto[]
  memoryAt: string
  isSaved: boolean
}

export interface MapMarkerResponseDto {
  id: string
  lat: number
  lon: number
  city: string | null
  state: string | null
  country: string | null
}

export interface SearchExploreResponseDto {
  fieldName: string
  items: { value: string; data: AssetResponseDto }[]
}

export interface SearchResponseDto {
  assets: {
    count: number
    total: number
    items: AssetResponseDto[]
    nextCursor: string | null
    nextPage: string | null
  }
}

/** How memories-search (apps/memories/search) read a sentence. */
export interface SentenceSearchInfo {
  fallback?: boolean
  people?: string[]
  missingPeople?: string[]
  visual?: string
  /** [field, value], e.g. ["city", "Roma"] */
  place?: [string, string] | null
  when?: string
  media?: 'photo' | 'video' | null
  favorite?: boolean
}

export interface SentenceSearchResponseDto extends SearchResponseDto {
  memories?: SentenceSearchInfo
}

export type SearchSuggestionType = 'country' | 'state' | 'city' | 'camera-make' | 'camera-model' | 'camera-lens-model'

export interface SmartSearchDto {
  query: string
  size?: number
  page?: number
  withExif?: boolean
}

/** v3.2+ structured filter (subset). */
export interface SearchFilter {
  type?: { eq: AssetType }
  isMotion?: { eq: boolean }
  isFavorite?: { eq: boolean }
  city?: { eq: string }
  visibility?: { eq: AssetVisibility }
}

export interface MetadataSearchDto {
  filter?: SearchFilter
  size?: number
  cursor?: string
  withExif?: boolean
}

export interface AssetBulkUploadCheckResult {
  id: string
  action: 'accept' | 'reject'
  reason?: 'duplicate' | 'unsupported-format'
  assetId?: string
  isTrashed?: boolean
}

export interface AssetMediaResponseDto {
  id: string
  status: 'created' | 'duplicate'
}

/** Query params shared by /timeline/buckets and /timeline/bucket. */
export interface TimelineFilter {
  visibility?: AssetVisibility
  isFavorite?: boolean
  isTrashed?: boolean
  albumId?: string
  personId?: string
  orderBy?: 'takenAt' | 'createdAt'
  withStacked?: boolean
}
