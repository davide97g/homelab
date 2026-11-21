const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2024-05-01T00:00:00.000Z" or "2024-05-01" -> { y: 2024, m: 5 } (no TZ shifting). */
export function parseBucket(tb: string): { y: number; m: number } {
  return { y: Number(tb.slice(0, 4)), m: Number(tb.slice(5, 7)) }
}
export const monthName = (m: number) => MONTHS[m - 1]
export const monthShort = (m: number) => MONTHS[m - 1].slice(0, 3)
export const monthYear = (tb: string) => {
  const { y, m } = parseBucket(tb)
  return `${monthName(m)} ${y}`
}

/** Local wall-clock time of an asset from its UTC timestamp + offset (timeline payload). */
export function localDate(utc: string, offsetHours: number): Date {
  // Represent local wall time in a Date's UTC fields, then read with getUTC*.
  return new Date(new Date(utc).getTime() + offsetHours * 3600_000)
}

export function formatDay(d: Date, utcFields = true): string {
  const day = utcFields ? d.getUTCDate() : d.getDate()
  const mo = utcFields ? d.getUTCMonth() : d.getMonth()
  const y = utcFields ? d.getUTCFullYear() : d.getFullYear()
  return `${day} ${MONTHS[mo]} ${y}`
}
export function formatTime(d: Date, utcFields = true): string {
  const h = utcFields ? d.getUTCHours() : d.getHours()
  const m = utcFields ? d.getUTCMinutes() : d.getMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
export function weekday(d: Date): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]
}

/** ms (timeline) -> "1:05" */
export function formatDurationMs(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "0:01:05.000000" (asset DTO) -> ms */
export function parseDuration(d: string | null | undefined): number | null {
  if (!d) return null
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(d)
  if (!m) return null
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000
    i++
  }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`
}

export const formatCount = (n: number) => n.toLocaleString('en-US')

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
