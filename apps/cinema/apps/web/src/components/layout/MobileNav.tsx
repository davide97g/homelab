import { NavLink } from 'react-router-dom'
import { useUserViews } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

/**
 * Below `lg` the rail is gone, so navigation becomes a scrolling text row --
 * same links, same active treatment, nothing hidden behind a hamburger.
 */
export function MobileNav() {
  const { data: views } = useUserViews()

  return (
    <nav className="flex min-w-0 items-center gap-5 overflow-x-auto no-scrollbar lg:hidden">
      <Item to="/" end>
        Home
      </Item>
      <Item to="/search">Search</Item>
      {views?.map((view) => (
        <Item key={view.Id} to={`/library/${view.Id}`}>
          {view.Name ?? 'Library'}
        </Item>
      ))}
    </nav>
  )
}

function Item({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'shrink-0 text-sm whitespace-nowrap transition-colors',
          isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}
