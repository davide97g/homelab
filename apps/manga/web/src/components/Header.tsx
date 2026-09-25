import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquareQuote, Search, X } from 'lucide-react'
import { useAuth } from '@/lib/kavita/auth'
import { ScanButton } from './ScanButton'
import { Wordmark } from './ui'

export function Header({ query, onQuery }: { query?: string; onQuery?: (q: string) => void }) {
  const { user, isAdmin, signOut } = useAuth()
  const [searching, setSearching] = useState(!!query)
  const [menu, setMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searching) input.current?.focus()
  }, [searching])

  const closeSearch = () => {
    setSearching(false)
    onQuery?.('')
  }

  return (
    <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-5 pb-2 sm:px-8 sm:pt-8">
      <Link to="/" aria-label="Yomu, home" className="shrink-0">
        <Wordmark />
      </Link>

      <div className="ml-auto flex items-center gap-2">
        {onQuery &&
          (searching ? (
            <div className="flex items-center gap-1 rounded-full border-2 border-ink bg-sheet pl-3.5 pr-1">
              <Search className="size-4 text-ink-2" strokeWidth={2.4} />
              <input
                ref={input}
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                placeholder="Find a series"
                aria-label="Find a series"
                className="w-32 bg-transparent py-1.5 text-[0.95rem] outline-none placeholder:text-ink-3 sm:w-52"
              />
              <button onClick={closeSearch} aria-label="Close search" className="rounded-full p-1.5 hover:bg-paper">
                <X className="size-4" strokeWidth={2.4} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearching(true)}
              aria-label="Find a series"
              className="rounded-full p-2.5 text-ink transition hover:bg-sheet"
            >
              <Search className="size-5" strokeWidth={2.4} />
            </button>
          ))}

        <Link
          to="/search"
          aria-label="Who said it? Search the scripts"
          title="Who said it?"
          className={searching ? 'hidden' : 'rounded-full p-2.5 text-ink transition hover:bg-sheet'}
        >
          <MessageSquareQuote className="size-5" strokeWidth={2.4} />
        </Link>

        {isAdmin && (
          <div className={searching ? 'hidden sm:block' : undefined}>
            <ScanButton />
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setMenu((m) => !m)}
            aria-label="Account"
            aria-expanded={menu}
            className="display grid size-10 place-items-center rounded-full bg-ink text-[1.05rem] font-bold text-sheet uppercase"
          >
            {user?.username.slice(0, 1)}
          </button>
          {menu && (
            <div className="pop absolute right-0 top-[calc(100%+10px)] z-30 w-48 rounded-2xl border-2 border-ink bg-sheet p-1.5 shadow-[3px_4px_0_var(--ink)]">
              <p className="px-3 pt-2 pb-1 text-[0.8rem] text-ink-3">Signed in as {user?.username}</p>
              <button
                onClick={signOut}
                className="w-full rounded-xl px-3 py-2 text-left text-[0.95rem] hover:bg-paper"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
