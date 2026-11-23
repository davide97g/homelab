import { Link } from 'react-router-dom'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { ScrollRow } from '@/components/media/MediaRow'
import { DotList } from '@/components/media/item-meta'
import { tmdbImage } from '@/lib/discover/client'
import { discoverPath, discoverTitle, discoverYear } from '@/lib/discover/format'
import { STANDING_LABEL, standingOf, type Standing } from '@/lib/discover/status'
import type { DiscoverResult, MediaType } from '@/lib/discover/types'
import { cn } from '@/lib/utils'

/**
 * A title from TMDB, through Seerr. It looks like a library card on purpose --
 * one grammar for "a film" -- and adds the one thing a library card never
 * needs: whether it is here, on its way, or not asked for yet.
 */
export function DiscoverCard({ result, className }: { result: DiscoverResult; className?: string }) {
  const type = result.mediaType as MediaType
  const poster = tmdbImage(result.posterPath, 'w342')
  const title = discoverTitle(result)

  return (
    <Link
      to={discoverPath(type, result.id)}
      className={cn(
        'group relative block aspect-[2/3] overflow-hidden rounded-lg bg-surface outline-none',
        'ring-1 ring-transparent transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease)]',
        'hover:ring-white/15 focus-visible:ring-foreground',
        className,
      )}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-[600ms] ease-[var(--ease)] group-hover:scale-[1.04]"
        />
      ) : (
        <span className="grid size-full place-items-center px-3 text-center text-sm text-muted-foreground">{title}</span>
      )}

      <span className="art-scrim absolute inset-0" />

      <StandingBadge standing={standingOf(result.mediaInfo)} className="absolute top-2 right-2" />

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3">
        <TypeTag type={type} />
        <span className="line-clamp-2 text-sm leading-tight font-semibold">{title}</span>
        <DotList parts={[discoverYear(result)]} className="text-[0.6875rem]" />
      </span>
    </Link>
  )
}

/** Same mark as the library's KindTag; TMDB has two kinds, so the word is ours. */
export function TypeTag({ type, className }: { type: MediaType; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <span aria-hidden className="h-3 w-[3px] rounded-pill bg-primary" />
      <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-foreground/70 uppercase">
        {type === 'movie' ? 'Film' : 'Series'}
      </span>
    </span>
  )
}

/** Nothing for a title nobody asked for: the badge is news, not a default. */
export function StandingBadge({ standing, className }: { standing: Standing; className?: string }) {
  const label = STANDING_LABEL[standing]
  if (!label) return null
  const here = standing === 'available' || standing === 'partial'
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-pill bg-scrim px-2 py-1 text-[0.625rem] font-semibold backdrop-blur-sm',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-pill', here ? 'bg-match' : standing === 'blocked' ? 'bg-muted-foreground' : 'bg-amber')} />
      {label}
    </span>
  )
}

export function DiscoverRow({
  title,
  results,
  isLoading,
  seeAllTo,
}: {
  title: string
  results: DiscoverResult[] | undefined
  isLoading?: boolean
  seeAllTo?: string
}) {
  return (
    <ScrollRow
      title={title}
      seeAllTo={seeAllTo}
      isLoading={isLoading}
      isEmpty={!results?.length}
      skeleton={(i) => <StickerSkeleton key={i} shape="poster" delay={i * 80} className="w-40 shrink-0 rounded-lg" />}
    >
      {results?.map((r) => (
        <DiscoverCard key={`${r.mediaType}-${r.id}`} result={r} className="w-40 shrink-0 snap-start" />
      ))}
    </ScrollRow>
  )
}

export function DiscoverGrid({ results }: { results: DiscoverResult[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
      {results.map((r) => (
        <DiscoverCard key={`${r.mediaType}-${r.id}`} result={r} />
      ))}
    </div>
  )
}
