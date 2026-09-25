/** Jellyfin measures time in .NET ticks: 1 tick = 100 nanoseconds. */
export const TICKS_PER_SECOND = 10_000_000

export const ticksToSeconds = (ticks?: number | null): number =>
  (ticks ?? 0) / TICKS_PER_SECOND

export const secondsToTicks = (seconds: number): number =>
  Math.round(seconds * TICKS_PER_SECOND)

/** "2h 14m" -- for runtime badges. */
export function formatRuntime(ticks?: number | null): string {
  const total = Math.floor(ticksToSeconds(ticks) / 60)
  if (!total) return ''
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** "1:23:45" / "4:07" -- for player timecodes. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
