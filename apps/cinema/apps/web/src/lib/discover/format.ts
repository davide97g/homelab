import type { MediaType } from './types'

export const discoverTitle = (r: { title?: string; name?: string }) => r.title ?? r.name ?? ''

export const discoverYear = (r: { releaseDate?: string; firstAirDate?: string }) =>
  (r.releaseDate ?? r.firstAirDate)?.slice(0, 4) || null

export const discoverPath = (type: MediaType, id: number) => `/discover/${type}/${id}`
