import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, X } from 'lucide-react'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { ScrollRow } from '@/components/media/MediaRow'
import { DiscoverCard, DiscoverGrid, DiscoverRow } from '@/components/discover/DiscoverCard'
import { DiscoverError } from '@/lib/discover/client'
import {
  useDiscoverDetails,
  useDiscoverRow,
  useDiscoverSearch,
  useMyRequests,
  useProgress,
  type DiscoverRowId,
} from '@/lib/discover/queries'
import { MediaStatus, progressKey, type MediaRequest, type TitleProgress } from '@/lib/discover/types'

const ROWS: { id: DiscoverRowId; title: string }[] = [
  { id: 'trending', title: 'Trending this week' },
  { id: 'movies', title: 'Popular films' },
  { id: 'tv', title: 'Popular series' },
  { id: 'movies/upcoming', title: 'Coming to cinemas' },
  { id: 'tv/upcoming', title: 'New series on the way' },
]

/**
 * Everything that is not in the library yet: TMDB through Seerr, with a
 * Request button where the library has a Play button. The search field looks
 * outside the library, which is what the main Search does not.
 */
export function DiscoverRoute() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (query === urlQuery) return
    const id = setTimeout(() => setParams(query ? { q: query } : {}, { replace: true }), 250)
    return () => clearTimeout(id)
  }, [query, urlQuery, setParams])

  const term = urlQuery.trim()
  const search = useDiscoverSearch(term)
  const trending = useDiscoverRow('trending')

  // The first call answers for all of them: no Seerr, no Discover.
  if (trending.error) return <Unavailable error={trending.error} />

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
        <div className="relative max-w-2xl">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a film or series to request…"
            aria-label="Search titles to request"
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
      </div>

      {term.length > 1 ? (
        search.isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <StickerSkeleton key={i} shape="poster" delay={i * 50} className="rounded-lg" />
            ))}
          </div>
        ) : search.data?.length ? (
          <DiscoverGrid results={search.data} />
        ) : (
          <p className="py-10 text-lg font-semibold">Nothing on TMDB for “{term}”</p>
        )
      ) : (
        <>
          <MyRequestsRow />
          <DiscoverRow title={ROWS[0].title} results={trending.data} isLoading={trending.isLoading} />
          {ROWS.slice(1).map((row) => (
            <LazyRow key={row.id} id={row.id} title={row.title} />
          ))}
        </>
      )}
    </div>
  )
}

function LazyRow({ id, title }: { id: DiscoverRowId; title: string }) {
  const { data, isLoading } = useDiscoverRow(id)
  return <DiscoverRow title={title} results={data} isLoading={isLoading} />
}

/** What you asked for, so "did my request go through?" has an answer on the page. */
function MyRequestsRow() {
  const { data, isLoading } = useMyRequests()
  const requests = (data ?? []).filter((r) => r.media?.tmdbId)
  const moving = requests.filter((r) => r.media && r.media.status !== MediaStatus.Available)
  const { data: pipeline } = useProgress(moving.map((r) => ({ type: r.type, id: r.media!.tmdbId })))
  return (
    <ScrollRow
      title="Your requests"
      isLoading={isLoading}
      isEmpty={!requests.length}
      skeleton={(i) => <StickerSkeleton key={i} shape="poster" delay={i * 80} className="w-40 shrink-0 rounded-lg" />}
    >
      {requests.map((r) => (
        <RequestCard key={r.id} request={r} progress={pipeline?.titles[progressKey(r.type, r.media!.tmdbId)]} />
      ))}
    </ScrollRow>
  )
}

/** Seerr's request list has no titles or art: each card asks for its own details. */
function RequestCard({ request, progress }: { request: MediaRequest; progress?: TitleProgress }) {
  const { data } = useDiscoverDetails(request.type, request.media?.tmdbId)
  if (!data) return <StickerSkeleton shape="poster" className="w-40 shrink-0 rounded-lg" />
  return (
    <DiscoverCard
      result={{
        id: data.id,
        mediaType: request.type,
        title: data.mediaType === 'movie' ? data.title : data.name,
        releaseDate: data.mediaType === 'movie' ? data.releaseDate : data.firstAirDate,
        posterPath: data.posterPath,
        mediaInfo: data.mediaInfo ?? request.media,
      }}
      progress={progress}
      className="w-40 shrink-0 snap-start"
    />
  )
}

function Unavailable({ error }: { error: Error }) {
  const status = error instanceof DiscoverError ? error.status : 0
  return (
    <div className="flex flex-col items-start gap-2 py-10">
      <p className="text-lg font-semibold">Discover is not available right now</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {status === 401
          ? 'Your session expired. Log out and back in.'
          : status === 503
            ? 'The server has not been connected to Seerr yet.'
            : error.message}
      </p>
    </div>
  )
}
