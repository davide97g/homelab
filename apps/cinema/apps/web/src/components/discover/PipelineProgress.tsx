import { useEffect, useState } from 'react'
import type { Standing } from '@/lib/discover/status'
import type { PipelineStage, TitleProgress } from '@/lib/discover/types'
import { cn } from '@/lib/utils'

/**
 * A requested title on its way: four steps (approved, download, copy to the NAS,
 * library), the one in progress with its bar and time left, and when it should
 * be watchable. Fed by the mini PC's report through accounts; without it, the
 * steps still follow Seerr's status, just with no times.
 */

type Step = 'request' | 'download' | 'nas' | 'library'
const STEPS: { id: Step; label: string }[] = [
  { id: 'request', label: 'Requested' },
  { id: 'download', label: 'Download' },
  { id: 'nas', label: 'Copy to NAS' },
  { id: 'library', label: 'Library' },
]

const STEP_OF: Record<PipelineStage, Step> = {
  queued: 'download',
  downloading: 'download',
  stalled: 'download',
  importing: 'download',
  settling: 'nas',
  waiting: 'nas',
  sending: 'nas',
  verifying: 'nas',
  arrived: 'library',
}

export function PipelineProgress({
  standing,
  progress,
  className,
}: {
  standing: Standing
  progress: TitleProgress | undefined
  className?: string
}) {
  const now = useNow()
  const step: Step = progress ? STEP_OF[progress.stage] : standing === 'pending' ? 'request' : 'download'
  const current = STEPS.findIndex((s) => s.id === step)
  const line = describe(standing, progress, now)
  const eta = progress?.eta && progress.stage !== 'arrived' ? Date.parse(progress.eta) : null

  return (
    <section
      aria-label="Progress"
      className={cn('flex w-full max-w-md flex-col gap-3 rounded-lg bg-scrim/70 p-4 backdrop-blur-sm', className)}
    >
      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex flex-col gap-1.5">
            <span
              aria-hidden
              className={cn(
                'h-1 rounded-pill',
                i < current ? 'bg-match' : i === current ? (progress?.stage === 'stalled' ? 'bg-amber' : 'bg-primary') : 'bg-white/15',
              )}
            />
            <span
              className={cn(
                'text-[0.625rem] font-semibold tracking-wide uppercase',
                i === current ? 'text-foreground' : 'text-muted-foreground',
              )}
              aria-current={i === current ? 'step' : undefined}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">{line.title}</span>
          {line.percent !== null && <span className="text-xs text-muted-foreground tabular-nums">{line.percent}%</span>}
        </div>
        {line.percent !== null && (
          <div className="h-1.5 overflow-hidden rounded-pill bg-white/10">
            <div
              className={cn(
                'h-full rounded-pill transition-[width] duration-700 ease-[var(--ease)]',
                progress?.stage === 'stalled' ? 'bg-amber' : 'bg-primary',
              )}
              style={{ width: `${line.percent}%` }}
            />
          </div>
        )}
        {line.detail && <p className="text-xs text-muted-foreground tabular-nums">{line.detail}</p>}
        {progress?.message && progress.stage === 'stalled' && <p className="text-xs text-amber">{progress.message}</p>}
      </div>

      {eta !== null && (
        <p className="text-xs text-foreground/80">
          Ready to watch around <span className="font-semibold tabular-nums">{clock(eta)}</span>
          <span className="text-muted-foreground"> · {until(eta, now)}</span>
        </p>
      )}
    </section>
  )
}

/** A slim bar for a poster card: only while something is actually moving. */
export function ProgressSliver({ progress }: { progress: TitleProgress | undefined }) {
  if (!progress || progress.stage === 'arrived') return null
  const p = percentOf(progress)
  return (
    <span aria-hidden className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-pill bg-white/15">
      <span
        className={cn('block h-full rounded-pill', progress.stage === 'stalled' ? 'bg-amber' : progress.transfer ? 'bg-match' : 'bg-primary')}
        style={{ width: `${p ?? 0}%` }}
      />
    </span>
  )
}

function percentOf(p: TitleProgress) {
  if (STEP_OF[p.stage] === 'nas' && p.transfer?.total) return Math.floor((p.transfer.bytes / p.transfer.total) * 100)
  if (p.download?.size) return Math.floor(((p.download.size - p.download.left) / p.download.size) * 100)
  return null
}

function describe(standing: Standing, p: TitleProgress | undefined, now: number): { title: string; percent: number | null; detail: string | null } {
  if (!p) {
    if (standing === 'pending') return { title: 'Waiting for an admin to approve it', percent: null, detail: null }
    return { title: 'Looking for a good copy', percent: null, detail: 'It starts downloading as soon as one turns up.' }
  }
  const files = p.files > 1 ? ` · ${p.filesArrived} of ${p.files} files there` : ''
  const d = p.download
  const t = p.transfer
  switch (p.stage) {
    case 'queued':
      return { title: 'Queued for download', percent: percentOf(p), detail: d ? `${bytes(d.size - d.left)} of ${bytes(d.size)}` : null }
    case 'downloading':
      return {
        title: 'Downloading',
        percent: percentOf(p),
        detail: d ? `${bytes(d.size - d.left)} of ${bytes(d.size)}${d.eta ? ` · ${until(Date.parse(d.eta), now)} left` : ''}` : null,
      }
    case 'stalled':
      return { title: 'Download stuck', percent: percentOf(p), detail: d ? `${bytes(d.size - d.left)} of ${bytes(d.size)}` : null }
    case 'importing':
      return { title: 'Downloaded, moving it into place', percent: 100, detail: null }
    case 'settling':
      return {
        title: 'Waiting for subtitles',
        percent: null,
        detail: t?.startsAt ? `The copy to the NAS starts around ${clock(Date.parse(t.startsAt))}${files}` : null,
      }
    case 'waiting':
      return {
        title: t?.paused ? 'Copy to the NAS is paused' : 'Next in line for the NAS',
        percent: null,
        detail: t?.paused ? 'It resumes when NAS sync is switched back on.' : t?.startsAt ? `Starts around ${clock(Date.parse(t.startsAt))}${files}` : null,
      }
    case 'sending':
      return {
        title: t?.paused ? 'Copy to the NAS is paused' : 'Copying to the NAS',
        percent: percentOf(p),
        detail: t ? `${bytes(t.bytes)} of ${bytes(t.total)}${t.eta && !t.paused ? ` · ${until(Date.parse(t.eta), now)} left` : ''}${files}` : null,
      }
    case 'verifying':
      return { title: 'Checking the copy', percent: 100, detail: 'Comparing checksums on both ends.' }
    case 'arrived':
      return { title: 'On the NAS, adding it to the library', percent: null, detail: 'The Watch button appears in a minute or two.' }
  }
}

/** Re-renders every 30 s, so "12 min" counts down between polls. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function until(ms: number, now: number) {
  const min = Math.max(1, Math.round((ms - now) / 60_000))
  if (min < 60) return `~${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return h < 24 ? `~${h} h${m ? ` ${m} min` : ''}` : `~${Math.round(h / 24)} d`
}

function bytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.max(0, Math.round(n / 1e3))} KB`
}
