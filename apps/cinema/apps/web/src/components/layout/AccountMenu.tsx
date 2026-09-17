import { useEffect, useRef } from 'react'
import { ChevronDown, LogOut, Settings } from 'lucide-react'
import { useAuth } from '@/lib/jellyfin/auth'

/**
 * Top-right of the content column, floating over the page rather than sitting
 * in a bar: Reel has no chrome band across the top.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth()
  const menuRef = useRef<HTMLDetailsElement>(null)

  // A <details> menu stays open on outside clicks; close it by hand.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.open) return
      if (!menuRef.current.contains(event.target as Node)) menuRef.current.open = false
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const initials = user?.Name?.slice(0, 2).toUpperCase() ?? '?'

  return (
    <details ref={menuRef} className="relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-pill p-0.5 pr-1.5 transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 place-items-center rounded-pill bg-surface-2 text-xs font-semibold">
          {initials}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-52 rounded-lg border border-[var(--hairline)] bg-surface p-1 shadow-panel">
        <p className="truncate px-3 py-2 text-xs text-muted-foreground">
          Signed in as {user?.Name ?? 'unknown'}
        </p>
        <a
          href="/jf/web/index.html#/dashboard"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Settings className="size-4" />
          Jellyfin dashboard
        </a>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </details>
  )
}
