import { NavLink, useNavigate } from 'react-router-dom'
import { Images, LayoutGrid, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Floating liquid-glass tab capsule + separate round search button (iOS 26). */
export function TabBar({ searchActive }: { searchActive?: boolean }) {
  const navigate = useNavigate()
  const tab = (to: string, label: string, Icon: typeof Images) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex h-full min-w-[96px] flex-col items-center justify-center gap-0.5 rounded-full px-4 text-[10px] font-semibold transition-colors',
          isActive && !searchActive ? 'bg-fill text-accent' : 'text-label',
        )
      }
    >
      <Icon className="size-[22px]" strokeWidth={2} />
      {label}
    </NavLink>
  )
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end justify-center gap-3 px-4"
      style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
    >
      <div className="glass pointer-events-auto flex h-[62px] items-center rounded-full p-1">
        {tab('/', 'Library', Images)}
        {tab('/collections', 'Collections', LayoutGrid)}
      </div>
      <button
        type="button"
        aria-label={searchActive ? 'Close search' : 'Search'}
        onClick={() => (searchActive ? navigate(-1) : navigate('/search'))}
        className={cn('glass pointer-events-auto flex size-[62px] items-center justify-center rounded-full', searchActive ? 'text-accent' : 'text-label')}
      >
        {searchActive ? <X className="size-6" /> : <Search className="size-6" strokeWidth={2.2} />}
      </button>
    </nav>
  )
}

/** Height reserved at the bottom of scroll content for the floating bar. */
export const TAB_BAR_SPACE = 96
