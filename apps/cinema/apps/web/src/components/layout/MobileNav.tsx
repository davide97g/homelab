import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/lib/jellyfin/auth'
import { useUserViews } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

/**
 * Below `lg` the rail is gone, so navigation becomes a scrolling pill row.
 * Same links, same active treatment, no hamburger to hide them behind.
 */
export function MobileNav() {
  const { data: views } = useUserViews()
  const { signOut } = useAuth()

  return (
    <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar lg:hidden">
      <Pill to="/" end>
        Home
      </Pill>
      {views?.map((view) => (
        <Pill key={view.Id} to={`/library/${view.Id}`}>
          {view.Name ?? 'Library'}
        </Pill>
      ))}
      <button
        type="button"
        onClick={signOut}
        aria-label="Log out"
        className="panel ml-auto grid size-9 shrink-0 place-items-center rounded-pill text-muted-foreground"
      >
        <LogOut className="size-4" />
      </button>
    </nav>
  )
}

function Pill({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'shrink-0 rounded-pill px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground shadow-primary-glow'
            : 'panel text-muted-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}
