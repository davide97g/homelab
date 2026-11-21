import type { AssetResponseDto } from './api/types'
import type { TimelineAsset } from '@/features/timeline/store'
import { parseDuration } from './format'

/** Full asset DTO (search, memories) -> the compact shape the grid/viewer use. */
export function toTimelineAsset(a: AssetResponseDto): TimelineAsset {
  const w = a.width ?? a.exifInfo?.exifImageWidth ?? 1
  const h = a.height ?? a.exifInfo?.exifImageHeight ?? 1
  // localDateTime is wall-clock encoded as UTC; derive the offset from it.
  const offset = (new Date(a.localDateTime).getTime() - new Date(a.fileCreatedAt).getTime()) / 3600_000
  return {
    id: a.id,
    ratio: w && h ? w / h : 1,
    thumbhash: a.thumbhash,
    fileCreatedAt: a.fileCreatedAt,
    localOffsetHours: Number.isFinite(offset) ? offset : 0,
    isImage: a.type === 'IMAGE',
    duration: parseDuration(a.duration),
    isFavorite: a.isFavorite,
    livePhotoVideoId: a.livePhotoVideoId ?? null,
    city: a.exifInfo?.city ?? null,
    country: a.exifInfo?.country ?? null,
  }
}
