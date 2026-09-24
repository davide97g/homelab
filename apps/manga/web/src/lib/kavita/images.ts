import { imageKey } from './client'
import type { Series } from './types'

const key = () => encodeURIComponent(imageKey())

// `v` is Kavita's cover file name, which changes when a cover is replaced (the
// covers service's upload renames v4_c5.png to series4.png). A new cover is a
// new URL, so no browser can keep showing the old one out of its cache.
export const seriesCover = (series: Pick<Series, 'id' | 'coverImage'>) =>
  `/api/image/series-cover?seriesId=${series.id}&apiKey=${key()}&v=${encodeURIComponent(series.coverImage ?? '')}`

export const chapterCover = (chapterId: number) =>
  `/api/image/chapter-cover?chapterId=${chapterId}&apiKey=${key()}`

export const pageImage = (chapterId: number, page: number) =>
  `/api/reader/image?chapterId=${chapterId}&page=${page}&apiKey=${key()}&extractPdf=true`
