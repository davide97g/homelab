import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Pause } from 'lucide-react'
import { useActiveViewers, type Viewer } from '@/lib/jellyfin/queries'
import { formatTimecode } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'
import { displayTitle, factLine } from '@/components/media/item-facts'

/**
 * How many people have something playing, and what. Sits beside the account
 * menu, and is absent -- not zeroed -- when nobody is watching: an empty house
 * is the normal state of a home server, and a permanent "0" would be chrome.
 */
export function ViewersMenu() {
  const { data: viewers } = useActiveViewers()
  const menuRef = useRef<HTMLDetailsElement>(null)

  // Same as the account menu: <details> ignores outside clicks on its own.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.open) return
      if (!menuRef.current.contains(event.target as Node)) menuRef.current.open = false
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  // Nobody watching, or the server would not say -- Jellyfin answers 403 to a
  // non-administrator asking about other people's sessions.
  if (!viewers?.length) return null

  return (
    <details ref={menuRef} className="relative shrink-0">
      <summary
        aria-label={`${viewers.length} watching now`}
        className="flex cursor-pointer list-none items-center gap-2 rounded-pill bg-surface py-1.5 pr-3 pl-2.5 text-sm transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden"
      >
        <Eye className="size-4 text-primary" />
        <span className="font-medium tabular-nums">{viewers.length}</span>
        <span className="hidden text-muted-foreground sm:inline">watching</span>
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-[var(--hairline)] bg-surface p-1 shadow-panel">
        <p className="px-3 py-2 text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Watching now
        </p>
        {viewers.map((viewer) => (
          <ViewerRow key={viewer.sessionId} viewer={viewer} />
        ))}
      </div>
    </details>
  )
}

function ViewerRow({ viewer }: { viewer: Viewer }) {
  const { item, positionSeconds, runtimeSeconds } = viewer
  const percent = runtimeSeconds ? Math.min(100, (positionSeconds / runtimeSeconds) * 100) : 0
  const initials = viewer.userName.slice(0, 2).toUpperCase()

  return (
    <Link
      to={`/item/${item.Id}`}
      onClick={(event) => {
        // Close the menu on the way out, or it stays open over the next page.
        event.currentTarget.closest('details')?.removeAttribute('open')
      }}
      className="flex items-start gap-2.5 rounded-md px-3 py-2 transition-colors hover:bg-surface-2"
    >
      {viewer.avatarUrl ? (
        <img
          src={viewer.avatarUrl}
          alt=""
          className="size-8 shrink-0 rounded-pill object-cover"
        />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-semibold">
          {initials}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{viewer.userName}</span>
          {viewer.isThisDevice && (
            <span className="shrink-0 text-[0.625rem] text-muted-foreground">this device</span>
          )}
          {viewer.isPaused && (
            <Pause aria-label="Paused" className="size-3 shrink-0 text-muted-foreground" />
          )}
        </span>

        <span className="truncate text-xs text-muted-foreground">
          {[displayTitle(item), ...factLine(item).slice(0, 2)].filter(Boolean).join(' · ')}
        </span>

        {/* Where they are, not how far they have left: a timecode is the thing
            you say out loud when someone asks "where are you up to?". */}
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn('h-[3px] min-w-0 flex-1 rounded-pill bg-white/15', !percent && 'opacity-0')}
          >
            <span className="block h-full rounded-pill bg-primary" style={{ width: `${percent}%` }} />
          </span>
          <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
            {formatTimecode(positionSeconds)}
          </span>
        </span>
      </span>
    </Link>
  )
}
