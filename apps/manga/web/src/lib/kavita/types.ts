// The slice of Kavita's DTOs this app reads. Field names follow the server's
// camelCase JSON; anything not listed here is ignored, not missing.

export interface AuthKey {
  name: string
  key: string
}

export interface User {
  id: number
  username: string
  roles: string[]
  token: string
  refreshToken: string | null
  authKeys: AuthKey[]
}

export interface Series {
  id: number
  name: string
  sortName: string | null
  localizedName: string | null
  pages: number
  pagesRead: number
  libraryId: number
  format: number
  created: string
  lastChapterAdded: string
  lastChapterAddedUtc: string
  latestReadDate: string
  primaryColor: string | null
  coverImage: string | null
}

export interface Chapter {
  id: number
  range: string
  number: string
  minNumber: number
  sortOrder: number
  pages: number
  pagesRead: number
  isSpecial: boolean
  title: string
  titleName: string
  volumeId: number
  createdUtc: string
  lastReadingProgressUtc: string
}

export interface Volume {
  id: number
  name: string
  minNumber: number
  chapters: Chapter[]
}

export interface SeriesDetail {
  specials: Chapter[]
  chapters: Chapter[]
  volumes: Volume[]
  libraryType: number
  unreadCount: number
  totalCount: number
}

export interface Named {
  id: number
  title?: string
  name?: string
}

export interface SeriesMetadata {
  summary: string | null
  genres: Named[]
  tags: Named[]
  writers: Named[]
  releaseYear: number
  publicationStatus: number
}

export interface ChapterInfo {
  chapterNumber: string
  volumeNumber: string
  volumeId: number
  seriesName: string
  seriesId: number
  libraryId: number
  libraryType: number
  chapterTitle: string
  pages: number
  isSpecial: boolean
  subtitle: string | null
  title: string
}

export interface Progress {
  volumeId: number
  chapterId: number
  pageNum: number
  seriesId: number
  libraryId: number
}

// PublicationStatus on the server.
export const STATUS_LABEL: Record<number, string> = {
  0: 'Ongoing',
  1: 'On hiatus',
  2: 'Completed',
  3: 'Cancelled',
  4: 'Ended',
}
