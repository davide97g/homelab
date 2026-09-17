import { Link, NavLink } from 'react-router-dom'
import { Clapperboard, Compass, Heart, Home, Library, LogOut, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'
import { useResumeItems, useUserViews } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

/**
 * The left rail: brand, navigation, what you left half-watched, sign out.
 *
 * Libraries come from the server rather than a hard-coded list, so a new
 * Jellyfin library shows up here the moment it is scanned.
 */
export function Sidebar() {
  const { user, signOut } = useAuth()
  const { data: views } = useUserViews()
  const { data: resume } = useResumeItems()

  return (
    <aside className="panel sticky top-5 hidden h-[calc(100dvh-2.5rem)] w-64 shrink-0 flex-col gap-6 rounded-3xl p-4 lg:flex">
      <Link to="/" className="flex items-center gap-2.5 px-2 pt-2">
        <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-primary-glow">
          <Clapperboard className="size-5" />
        </span>
        <span className="font-display text-lg font-bold tracking-tight">Cinema</span>
      </Link>

      <nav className="flex flex-col gap-1">
        <NavItem to="/" icon={Home} end>
          Home
        </NavItem>
        <NavItem to="/search" icon={Search}>
          Search
        </NavItem>
        {views?.map((view) => (
          <NavItem key={view.Id} to={`/library/${view.Id}`} icon={iconForView(view)}>
            {view.Name ?? 'Library'}
          </NavItem>
        ))}
      </nav>

      {/* Mirrors the "online players" block in the reference layout -- the
          personal, glanceable list that makes the rail feel lived-in. */}
      {!!resume?.length && (
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <p className="px-3 pb-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Continue watching
          </p>
          <div className="flex flex-col gap-0.5">
            {resume.slice(0, 5).map((item) => (
              <ResumeLink key={item.Id} item={item} />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={signOut}
        className="panel-inset mt-auto flex w-full items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
      >
        <LogOut className="size-4" />
        Log out
        <span className="sr-only"> of {user?.Name ?? 'Jellyfin'}</span>
      </button>
    </aside>
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
          'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]',
          isActive
            ? 'bg-surface-2 text-primary-soft shadow-card'
            : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
        )
      }
    >
      <Icon className="size-4.5 shrink-0" />
      <span className="truncate">{children}</span>
    </NavLink>
  )
}

function ResumeLink({ item }: { item: BaseItemDto }) {
  const { api } = useAuth()
  const poster = itemImageUrl(api, item, ImageType.Primary, { maxWidth: 80 })
  const progress = item.UserData?.PlayedPercentage ?? 0

  return (
    <Link
      to={`/item/${item.Id}`}
      className="group flex items-center gap-2.5 rounded-2xl px-3 py-2 transition-colors hover:bg-surface-2/60"
    >
      <span className="relative size-9 shrink-0 overflow-hidden rounded-xl bg-surface-2">
        {poster && <img src={poster} alt="" className="size-full object-cover" />}
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
          <span className="block h-full bg-primary" style={{ width: `${progress}%` }} />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground/90 group-hover:text-foreground">
          {item.Type === 'Episode' ? item.SeriesName : item.Name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {Math.round(progress)}% watched
        </span>
      </span>
    </Link>
  )
}

/** Jellyfin tells us what a view holds; the icon just makes it scannable. */
function iconForView(view: BaseItemDto): LucideIcon {
  switch (view.CollectionType) {
    case 'movies':
      return Clapperboard
    case 'tvshows':
      return Compass
    case 'playlists':
    case 'boxsets':
      return Heart
    default:
      return Library
  }
}
