import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useScanLibrary } from '@/lib/kavita/queries'
import { listNames } from '@/lib/format'
import { Bubble, Button, Spinner } from './ui'

// New downloads reach the shelf only after a scan. The button answers in a
// bubble of its own, then goes quiet again.
export function ScanButton({ compact }: { compact?: boolean }) {
  const scan = useScanLibrary()
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(null), 6000)
    return () => clearTimeout(t)
  }, [said])

  const run = () => {
    setSaid(null)
    scan.mutate(undefined, {
      onSuccess: (changed) => {
        const names = changed.map((s) => s.name)
        setSaid(
          names.length === 0
            ? 'Nothing new. The shelf is up to date.'
            : names.length > 3
              ? `New chapters in ${names.length} series.`
              : `New chapters in ${listNames(names)}.`,
        )
      },
      onError: (e) => setSaid(`The scan didn't start: ${e.message}`),
    })
  }

  return (
    <div className="relative">
      <Button variant="line" onClick={run} disabled={scan.isPending} aria-live="polite">
        {scan.isPending ? <Spinner /> : <RefreshCw className="size-4" strokeWidth={2.4} />}
        <span className={compact ? 'sr-only' : 'sr-only sm:not-sr-only sm:whitespace-nowrap'}>
          {scan.isPending ? 'Scanning…' : 'Scan library'}
        </span>
      </Button>
      {said && (
        <Bubble up tailX="calc(100% - 44px)" className="absolute right-0 top-[calc(100%+18px)] z-30 w-64 px-4 py-3 text-[0.95rem] leading-snug">
          {said}
        </Bubble>
      )}
    </div>
  )
}
