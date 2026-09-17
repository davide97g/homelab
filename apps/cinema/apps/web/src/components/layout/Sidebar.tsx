import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Clapperboard, Film, Home, Library, ListVideo, LogOut, Search, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useAuth } from '@/lib/jellyfin/auth'
import { useUserViews } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

/**
 * The left rail: search, then navigation grouped into what the server offers
 * and what belongs to you. No panel, no border -- the rail is separated from
 * the content by space alone, which is the whole point of Reel.
 */
export function Sidebar() {
  const { signOut } = useAuth()
  const { data: views } = useUserViews()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-7 px-5 py-6 lg:flex">
      <Link to="/" className="flex items-center gap-2 px-2">
        <Film className="size-5 text-primary" />
        <span className="text-lg font-bold tracking-tight">Cinema</span>
      </Link>

      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault()
          if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search"
          className="h-9 w-full rounded-pill bg-surface px-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:bg-surface-2"
        />
      </form>

      <nav className="flex flex-col gap-6 overflow-y-auto no-scrollbar">
        <NavItem to="/" icon={Home} end>
          Home
        </NavItem>

        {!!views?.length && (
          <Group label="Library">
            {views.map((view) => (
              <NavItem key={view.Id} to={`/library/${view.Id}`} icon={iconForView(view)}>
                {view.Name ?? 'Library'}
              </NavItem>
            ))}
          </Group>
        )}
      </nav>

      <button
        type="button"
        onClick={signOut}
        className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="size-4" />
        Log out
      </button>
    </aside>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 pb-1 text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      {children}
    </div>
  )
}

function NavItem({
  to,
  icon: Icon,
  end,
  children,
}: {
  to: string
  icon: LucideIcon
  end?: boolean
  children: React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group/nav relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-surface font-medium text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The active marker is the only red in the rail. */}
          <span
            aria-hidden
            className={cn(
              'absolute left-0 h-4 w-0.5 rounded-pill bg-primary transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{children}</span>
        </>
      )}
    </NavLink>
  )
}

/** Jellyfin tells us what a view holds; the icon just makes it scannable. */
function iconForView(view: BaseItemDto): LucideIcon {
  switch (view.CollectionType) {
    case 'movies':
      return Clapperboard
    case 'tvshows':
      return Tv
    case 'playlists':
    case 'boxsets':
      return ListVideo
    default:
      return Library
  }
}
