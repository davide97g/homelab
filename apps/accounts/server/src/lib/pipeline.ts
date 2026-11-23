import { readFile, stat } from 'node:fs/promises'
import { env } from '../env.ts'
import * as jellyfin from '../upstream/jellyfin.ts'
import * as seerr from '../upstream/seerr.ts'

/**
 * The mini PC's report on every title between the download and the NAS
 * (hosts/debian/nas-sync/nas-pipeline.py), pushed every few seconds into a
 * folder mounted here. Two uses: Discover's progress bars, and refreshing
 * Jellyfin the moment a file has arrived, so the film shows up in minutes
 * instead of at the next scheduled scan.
 */

export type Stage =
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
  stage: Stage
  message: string | null
  download: { size: number; left: number; eta: string | null; state: Stage } | null
  transfer: { bytes: number; total: number; startsAt: string | null; eta: string | null; paused: boolean } | null
  eta: string | null
  files: number
  filesArrived: number
  arrivedAt: string | null
}

export type PipelineStatus = {
  v: 1
  at: string
  sync: { enabled: boolean; note: string; rateBps: number; measured: boolean }
  titles: Record<string, TitleProgress>
  arrived: { key: string | null; path: string; at: string }[]
}

/** The mini PC pushes at least once a minute; older than this, it is down or cut off. */
const STALE_MS = 3 * 60_000

let cache: { mtimeMs: number; doc: PipelineStatus } | null = null

export async function readPipeline(): Promise<PipelineStatus | null> {
  try {
    const s = await stat(env.PIPELINE_STATUS_FILE)
    if (cache?.mtimeMs !== s.mtimeMs) {
      const doc = JSON.parse(await readFile(env.PIPELINE_STATUS_FILE, 'utf8')) as PipelineStatus
      if (doc.v !== 1) return null
      cache = { mtimeMs: s.mtimeMs, doc }
    }
    return cache.doc
  } catch {
    return null
  }
}

export const isStale = (doc: PipelineStatus) => Date.now() - Date.parse(doc.at) > STALE_MS

/**
 * Watches the report for files that arrived on the NAS and asks Jellyfin to scan
 * their folders, then Seerr to look at Jellyfin's recently added, so the title
 * turns "available" (and gets its Play button) without waiting for either schedule.
 * Jellyfin's real-time monitor may beat us to it; a second scan is harmless.
 */
export function startLibraryRefresh() {
  if (!jellyfin.jellyfinEnabled()) return
  const seen = new Set<string>()
  let seerrTimers: ReturnType<typeof setTimeout>[] = []

  const tick = async () => {
    const doc = await readPipeline()
    if (!doc) return
    const fresh = doc.arrived.filter((a) => !seen.has(`${a.path}|${a.at}`))
    if (!fresh.length) return
    const paths = fresh.map((a) => `${env.JELLYFIN_MEDIA_ROOT.replace(/\/+$/, '')}/${a.path}`)
    try {
      await jellyfin.mediaCreated(paths)
      for (const a of fresh) seen.add(`${a.path}|${a.at}`)
      console.log(`library refresh: ${paths.join(', ')}`)
    } catch (e) {
      console.error('library refresh: Jellyfin refused', e)
      return
    }
    if (!seerr.seerrEnabled()) return
    // Jellyfin needs a moment to probe the file; Seerr then picks it up from recently added.
    for (const t of seerrTimers) clearTimeout(t)
    seerrTimers = [45_000, 180_000].map((ms) =>
      setTimeout(() => seerr.runJob('jellyfin-recently-added-scan').catch((e) => console.error('seerr scan', e)), ms),
    )
  }

  setInterval(() => void tick().catch((e) => console.error('library refresh', e)), 15_000)
  void tick()
}
