import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Search, Settings } from 'lucide-react'
import { HoloAvatar } from '@/components/ui/holo-avatar'
import { StickerKbd } from '@/components/ui/sticker-kbd'
import { useAuth } from '@/lib/jellyfin/auth'
import { useNextUp } from '@/lib/jellyfin/queries'

/**
 * Search, notifications, account. A single row, glass, always in reach.
 *
 * The "notification" is deliberately real: it counts what is waiting in Next
 * Up. A bell that never has anything behind it is decoration.
 */
export function TopBar() {
  const { user, signOut } = useAuth()
  const { data: nextUp } = useNextUp()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)

  // "/" focuses search, the way it does everywhere else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A <details> menu stays open on outside clicks; close it by hand.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.open) return
      if (!menuRef.current.contains(event.target as Node)) menuRef.current.open = false
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const waiting = nextUp?.length ?? 0

  return (
    <header className="panel flex items-center gap-2 rounded-3xl p-2 sm:gap-3">
      <form
        className="relative min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search films, series, people…"
          aria-label="Search"
          className="peer h-11 w-full rounded-pill bg-surface-2/70 pr-12 pl-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-surface-2 focus:ring-2 focus:ring-ring/60"
        />
        <StickerKbd
          watch="/"
          className="absolute top-1/2 right-3 -translate-y-1/2 peer-focus:opacity-0"
        >
          /
        </StickerKbd>
      </form>

      <IconButton label={`Next up (${waiting})`} onClick={() => navigate('/')}>
        <Bell className="size-4.5" />
        {waiting > 0 && (
          <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-[color-mix(in_srgb,var(--surface)_80%,transparent)]" />
        )}
      </IconButton>

      <details ref={menuRef} className="relative hidden sm:block">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-pill bg-surface-2/70 py-1.5 pr-3 pl-1.5 transition-colors hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
          <HoloAvatar size="sm" ring="foil" fallback={user?.Name?.slice(0, 2) ?? '?'} alt="" />
          <span className="max-w-28 truncate text-sm font-medium">{user?.Name ?? 'Account'}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </summary>
        <div className="panel absolute right-0 z-50 mt-2 w-56 rounded-2xl p-1.5">
          <a
            href="/jf/web/index.html#/dashboard"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <Settings className="size-4" />
            Jellyfin dashboard
          </a>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </details>
    </header>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative grid size-11 shrink-0 place-items-center rounded-pill bg-surface-2/70 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  )
}
