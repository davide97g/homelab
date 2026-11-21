import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CloudUpload, Copy, FileImage, FileVideo, Loader2, XCircle } from 'lucide-react'
import { api, uploadAsset } from '@/lib/api/client'
import { Page } from '@/components/Page'
import { invalidateTimelines } from '@/features/timeline/store'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'

type Status = 'queued' | 'hashing' | 'checking' | 'uploading' | 'done' | 'duplicate' | 'error'
interface Item {
  key: string
  file: File
  status: Status
  progress: number
  checksum?: string
  error?: string
}

const CF_LIMIT = 100 * 1024 * 1024
const CONCURRENCY = 2

async function sha1Base64(file: File): Promise<string | undefined> {
  // crypto.subtle only exists in secure contexts (https, localhost).
  if (!globalThis.crypto?.subtle) return undefined
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-1', buf)
  let bin = ''
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b)
  return btoa(bin)
}

export default function UploadRoute() {
  const qc = useQueryClient()
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const running = useRef(false)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  const process = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const queued = itemsRef.current.filter((i) => i.status === 'queued')
        if (!queued.length) break
        const batch = queued.slice(0, 50)
        // 1. hash
        for (const it of batch) {
          update(it.key, { status: 'hashing' })
          try {
            it.checksum = await sha1Base64(it.file)
          } catch (e) {
            it.checksum = undefined
            console.warn('hash failed', e)
          }
        }
        // 2. dedupe against the server
        const withSum = batch.filter((i) => i.checksum)
        const rejected = new Map<string, string>()
        if (withSum.length) {
          for (const it of withSum) update(it.key, { status: 'checking', checksum: it.checksum })
          try {
            const r = await api.bulkUploadCheck(withSum.map((i) => ({ id: i.key, checksum: i.checksum! })))
            for (const x of r.results) if (x.action === 'reject') rejected.set(x.id, x.reason ?? 'rejected')
          } catch {
            /* upload anyway; the server dedupes too */
          }
        }
        const toUpload: Item[] = []
        for (const it of batch) {
          const why = rejected.get(it.key)
          if (why === 'duplicate') update(it.key, { status: 'duplicate', progress: 1 })
          else if (why) update(it.key, { status: 'error', error: why })
          else toUpload.push(it)
        }
        // 3. upload with limited concurrency
        let next = 0
        const worker = async () => {
          while (next < toUpload.length) {
            const it = toUpload[next++]
            update(it.key, { status: 'uploading', progress: 0 })
            try {
              const r = await uploadAsset(it.file, it.checksum ?? '', (p) => update(it.key, { progress: p }))
              update(it.key, { status: r.status === 'duplicate' ? 'duplicate' : 'done', progress: 1 })
            } catch (e) {
              update(it.key, { status: 'error', error: e instanceof Error ? e.message : String(e) })
            }
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker))
        // let state settle before re-reading the queue
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      running.current = false
      invalidateTimelines()
      qc.invalidateQueries()
    }
  }, [qc])

  const add = useCallback((files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(heic|heif|dng|cr2|nef|arw|raf|mov|mp4|mkv)$/i.test(f.name))
    if (!list.length) return
    setItems((cur) => [
      ...cur,
      ...list.map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file, status: 'queued' as Status, progress: 0 })),
    ])
  }, [])

  useEffect(() => {
    if (items.some((i) => i.status === 'queued')) process()
  }, [items, process])

  // Whole-window drop target while this screen is open.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer?.files.length) add(e.dataTransfer.files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [add])

  const done = items.filter((i) => i.status === 'done').length
  const dup = items.filter((i) => i.status === 'duplicate').length
  const failed = items.filter((i) => i.status === 'error').length
  const active = items.filter((i) => !['done', 'duplicate', 'error'].includes(i.status)).length
  const overall = items.length ? items.reduce((s, i) => s + (i.status === 'done' || i.status === 'duplicate' ? 1 : i.status === 'uploading' ? i.progress : 0), 0) / items.length : 0

  return (
    <Page title="Upload" back grouped>
      <div className="px-4">
        <button
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging ? 'border-accent bg-accent/10' : 'border-separator bg-card',
          )}
        >
          <CloudUpload className="size-10 text-accent" strokeWidth={1.6} />
          <div className="text-[17px] font-semibold">Drop photos and videos here</div>
          <div className="text-[15px] text-label-2">or click to choose files</div>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*,.heic,.heif,.dng"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) add(e.target.files)
            e.target.value = ''
          }}
        />
        <p className="mt-2 px-1 text-[13px] text-label-2">
          Files over 100 MB are rejected on the public address (Cloudflare limit). Upload large videos from the home network.
          {!globalThis.crypto?.subtle && ' This page is not a secure context, so duplicate checks are skipped.'}
        </p>
      </div>

      {items.length > 0 && (
        <>
          <div className="mt-6 px-4">
            <div className="flex items-baseline justify-between text-[13px] text-label-2">
              <span>
                {active ? `Uploading ${active} of ${items.length}…` : 'Finished'} · {done} uploaded{dup ? ` · ${dup} already in library` : ''}
                {failed ? ` · ${failed} failed` : ''}
              </span>
              {!active && (
                <button className="text-accent" onClick={() => setItems([])}>
                  Clear
                </button>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${overall * 100}%` }} />
            </div>
          </div>
          <ul className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-card">
            {items.map((it, n) => (
              <li key={it.key} className={cn('flex items-center gap-3 px-4 py-2.5', n > 0 && 'border-t border-separator')}>
                {it.file.type.startsWith('video/') ? <FileVideo className="size-5 shrink-0 text-label-2" /> : <FileImage className="size-5 shrink-0 text-label-2" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]">{it.file.name}</div>
                  <div className="text-[12px] text-label-2">
                    {formatBytes(it.file.size)}
                    {it.file.size > CF_LIMIT && <span className="text-[#ff9f0a]"> · over 100 MB</span>}
                    {it.status === 'error' && <span className="text-destructive"> · {it.error}</span>}
                    {it.status === 'duplicate' && ' · already in library'}
                  </div>
                  {it.status === 'uploading' && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-fill">
                      <div className="h-full bg-accent" style={{ width: `${it.progress * 100}%` }} />
                    </div>
                  )}
                </div>
                <StatusIcon s={it.status} warn={it.file.size > CF_LIMIT} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  )
}

function StatusIcon({ s, warn }: { s: Status; warn: boolean }) {
  if (s === 'done') return <CheckCircle2 className="size-5 text-[#30d158]" />
  if (s === 'duplicate') return <Copy className="size-5 text-label-2" />
  if (s === 'error') return <XCircle className="size-5 text-destructive" />
  if (s === 'queued') return warn ? <AlertTriangle className="size-5 text-[#ff9f0a]" /> : <span className="text-[12px] text-label-2">Waiting</span>
  return <Loader2 className="size-5 animate-spin text-label-2" />
}
