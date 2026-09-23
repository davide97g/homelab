import { imageKey } from './client'

const key = () => encodeURIComponent(imageKey())

export const seriesCover = (seriesId: number) =>
  `/api/image/series-cover?seriesId=${seriesId}&apiKey=${key()}`

export const chapterCover = (chapterId: number) =>
  `/api/image/chapter-cover?chapterId=${chapterId}&apiKey=${key()}`

export const pageImage = (chapterId: number, page: number) =>
  `/api/reader/image?chapterId=${chapterId}&page=${page}&apiKey=${key()}&extractPdf=true`
