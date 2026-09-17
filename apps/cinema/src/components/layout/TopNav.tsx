import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { LogOut, Search } from 'lucide-react'
import { QuackButton } from '@/components/ui/quack-button'
import { GlowInput } from '@/components/ui/glow-input'
import { HoloAvatar } from '@/components/ui/holo-avatar'
import { HoloSeparator } from '@/components/ui/holo-separator'
import { StickerKbd } from '@/components/ui/sticker-kbd'
import { useAuth } from '@/lib/jellyfin/auth'
import { useUserViews } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

export function TopNav() {
  const { user, signOut } = useAuth()
  const { data: views } = useUserViews()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [scrolled, setScrolled] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Transparent over the hero, solid once you scroll -- the whole trick
  // behind the "floating over artwork" look.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // "/" focuses search, the way it does everywhere else. StickerKbd next to
  // the field advertises it and depresses on the real keystroke.
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

  return (
    <nav
      className={cn(
        'fixed inset-x-0 top-0 z-50 flex items-center gap-4 px-6 py-3 transition-colors duration-300 md:px-10',
        scrolled ? 'bg-scrim backdrop-blur-md' : 'bg-gradient-to-b from-black/70 to-transparent',
      )}
    >
      <Link
        to="/"
        className="font-display text-lg font-bold tracking-tight text-primary transition-[text-shadow] hover:[text-shadow:var(--glow-primary)]"
      >
        Cinema
      </Link>

      <HoloSeparator orientation="vertical" className="my-1 hidden sm:block" />

      <div className="flex items-center gap-1 text-sm">
        <NavItem to="/">Home</NavItem>
        {views?.map((view) => (
          <NavItem key={view.Id} to={`/library/${view.Id}`}>
            {view.Name}
          </NavItem>
        ))}
      </div>

      <form
        className="relative ml-auto hidden w-64 sm:block"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
        }}
      >
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <GlowInput
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search"
          className="peer pr-11 pl-9"
        />
        <StickerKbd
          watch="/"
          className="absolute top-1/2 right-2 -translate-y-1/2 peer-focus:opacity-0"
        >
          /
        </StickerKbd>
      </form>

      <div className="flex items-center gap-2">
        <HoloAvatar
          size="sm"
          ring="foil"
          fallback={user?.Name?.slice(0, 2) ?? '?'}
          alt={user?.Name ?? 'Signed in user'}
        />
        <QuackButton variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
          <LogOut />
        </QuackButton>
      </div>
    </nav>
  )
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'rounded-lg px-3 py-1.5 font-medium transition-colors',
          isActive
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}
