import type { Chapter, Named } from './kavita/types'

// ComicInfo titles repeat what the number already says:
//   "#001 - Chapter 1: Romance Dawn", "Vol.76 Ch.763 - Declaration of Humanity"
// Keep only the name.
export function chapterName(c: Pick<Chapter, 'titleName' | 'title' | 'range'>): string {
  const raw = (c.titleName || '').trim()
  const name = raw
    .replace(/^#\d+\s*[-–]\s*/, '')
    .replace(/^vol(ume)?\.?\s*\d+\s*/i, '')
    .replace(/^ch(apter)?\.?\s*[\d.]+\s*[:\-–]?\s*/i, '')
    .trim()
  return name && name !== c.range ? name : ''
}

export function chapterLabel(c: Pick<Chapter, 'range' | 'isSpecial' | 'title'>): string {
  if (c.isSpecial) return c.title || 'Special'
  return `Chapter ${c.range}`
}

// Metadata providers mix real genres with ratings, languages and edition
// flags. Only the ones a reader would browse by.
const NOT_GENRES = /:|^(japanese|korean|chinese|english|official colored|full color|long strip|web comic|award winning)$/i

export function genres(list: Named[], max = 5): string[] {
  return list
    .map((g) => g.title ?? '')
    .filter((t) => t && !NOT_GENRES.test(t))
    .slice(0, max)
}

export function cleanSummary(s: string | null | undefined): string {
  return (s ?? '').replace(/^from [^:\n]{1,30}:\s*/i, '').trim()
}

export function authorName(n: Named): string {
  // "Oda Eiichirou (尾田栄一郎)" -> "Oda Eiichirou"
  return (n.name ?? '').replace(/\s*\([^)]*\)\s*$/, '')
}

export function percent(read: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0
}

export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
