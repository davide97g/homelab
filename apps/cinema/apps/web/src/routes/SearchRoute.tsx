import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, X } from 'lucide-react'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaRow } from '@/components/media/MediaRow'
import { useItems, useSuggestions } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

const FILTERS = [
  { label: 'All', types: [BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode] },
  { label: 'Films', types: [BaseItemKind.Movie] },
  { label: 'Series', types: [BaseItemKind.Series, BaseItemKind.Episode] },
] as const

export function SearchRoute() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const [filter, setFilter] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // The field is the page; there is nothing else to focus on arrival.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Type, don't submit. The URL follows a beat behind so a result page stays
  // shareable and the back button still works, without a history entry per
  // keystroke.
  useEffect(() => {
    if (query === urlQuery) return
    const id = setTimeout(() => {
      setParams(query ? { q: query } : {}, { replace: true })
    }, 250)
    return () => clearTimeout(id)
  }, [query, urlQuery, setParams])

  const term = query.trim()
  const { data, isLoading } = useItems(
    {
      searchTerm: term,
      includeItemTypes: [...FILTERS[filter].types],
      limit: 60,
    },
    term.length > 0,
  )

  // With an empty field the page is not blank: it offers the library instead.
  const suggestions = useSuggestions(12)
  const results = data?.items ?? []

  return (
    <div className="flex flex-col gap-7">
      <div className="relative max-w-2xl">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search films, series, episodes…"
          aria-label="Search"
          className="h-12 w-full rounded-lg bg-surface pr-11 pl-11 text-base outline-none transition-colors placeholder:text-muted-foreground focus:bg-surface-2"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="absolute top-1/2 right-3 grid size-7 -translate-y-1/2 place-items-center rounded-pill text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {term ? (
        <>
          <div role="radiogroup" aria-label="Filter results" className="flex items-center gap-4 text-sm">
            {FILTERS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={index === filter}
                onClick={() => setFilter(index)}
                className={cn(
                  'transition-colors',
                  index === filter
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
            {!isLoading && (
              <span className="ml-auto text-xs text-muted-foreground">
                {results.length} {results.length === 1 ? 'result' : 'results'}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <StickerSkeleton key={i} shape="poster" delay={i * 50} className="rounded-lg" />
              ))}
            </div>
          ) : results.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {results.map((item) => (
                <MediaCard key={item.Id} item={item} />
              ))}
            </div>
          ) : (
            <NoResults term={term} />
          )}
        </>
      ) : (
        <MediaRow
          title="Something to watch"
          items={suggestions.data}
          isLoading={suggestions.isLoading}
        />
      )}
    </div>
  )
}

function NoResults({ term }: { term: string }) {
  return (
    <div className="flex flex-col items-start gap-2 py-10">
      <p className="text-lg font-semibold">No results for “{term}”</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Jellyfin matches on title, not on plot. Try a shorter title, or the original-language one —
        a film filed as <em>Il Padrino</em> will not answer to <em>The Godfather</em>.
      </p>
      <Link
        to="/"
        className="mt-2 inline-flex h-9 items-center rounded-md bg-white/10 px-4 text-sm font-semibold transition-colors hover:bg-white/20"
      >
        Back home
      </Link>
    </div>
  )
}
