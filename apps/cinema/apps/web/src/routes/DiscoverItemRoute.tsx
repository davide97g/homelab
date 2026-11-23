import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Info, Play, Plus, X } from 'lucide-react'
import { StickerSkeleton, StickerSkeletonText } from '@/components/ui/sticker-skeleton'
import { useQuackToast } from '@/components/ui/quack-toast'
import { DotList } from '@/components/media/item-meta'
import { DiscoverRow, StandingBadge, TypeTag } from '@/components/discover/DiscoverCard'
import { tmdbImage } from '@/lib/discover/client'
import { discoverTitle, discoverYear } from '@/lib/discover/format'
import {
  useCancelRequest,
  useDiscoverDetails,
  useDiscoverMe,
  useDiscoverRecommendations,
  useRequestTitle,
} from '@/lib/discover/queries'
import { seasonStandings, standingOf, type SeasonStanding } from '@/lib/discover/status'
import { RequestStatus, type Details, type DiscoverMe, type MediaType, type TvDetails } from '@/lib/discover/types'
import { cn } from '@/lib/utils'

export function DiscoverItemRoute() {
  const params = useParams<{ mediaType: string; tmdbId: string }>()
  const type = params.mediaType === 'tv' ? 'tv' : params.mediaType === 'movie' ? 'movie' : undefined
  const id = Number(params.tmdbId) || undefined
  const { data: item, isLoading, error } = useDiscoverDetails(type, id)
  const related = useDiscoverRecommendations(type, id)
  const { data: me } = useDiscoverMe()

  if (error) {
    return <p className="py-10 text-lg font-semibold">{error.message}</p>
  }
  if (isLoading || !item || !type) {
    return (
      <div className="flex flex-col gap-6">
        <StickerSkeleton className="h-[42vh] w-full rounded-xl" />
        <StickerSkeleton shape="title" delay={80} />
        <StickerSkeletonText className="max-w-2xl" lines={4} />
      </div>
    )
  }

  // Keyed by title: moving to a recommendation starts a fresh season choice.
  return <DiscoverItem key={`${type}-${item.id}`} item={item} type={type} me={me} related={related.data} />
}

function DiscoverItem({
  item,
  type,
  me,
  related,
}: {
  item: Details
  type: MediaType
  me: DiscoverMe | undefined
  related: Parameters<typeof DiscoverRow>[0]['results']
}) {
  const { toast } = useQuackToast()
  const request = useRequestTitle()
  const cancel = useCancelRequest()

  const title = discoverTitle(item)
  const backdrop = tmdbImage(item.backdropPath, 'w1280')
  const poster = tmdbImage(item.posterPath, 'w342')
  const standing = standingOf(item.mediaInfo)
  const jellyfinId = item.mediaInfo?.jellyfinMediaId
  const watchable = Boolean(jellyfinId) && (standing === 'available' || standing === 'partial')

  const seasons = useMemo(() => (item.mediaType === 'tv' ? seasonStandings(item.mediaInfo) : new Map<number, SeasonStanding>()), [item])
  const requestable = item.mediaType === 'tv' ? realSeasons(item).filter((s) => !seasons.has(s.seasonNumber)).map((s) => s.seasonNumber) : []
  const [picked, setPicked] = useState<Set<number>>(() => new Set(requestable))

  const canAsk = me?.canRequest[type] ?? false
  const askable =
    canAsk &&
    (item.mediaType === 'tv' ? requestable.length > 0 : standing === 'none')
  const ownPending = item.mediaInfo?.requests?.find(
    (r) => r.status === RequestStatus.Pending && r.requestedBy?.id === me?.id,
  )

  const submit = () => {
    const chosen = [...picked].sort((a, b) => a - b)
    if (item.mediaType === 'tv' && !chosen.length) return
    request.mutate(
      { mediaType: type, mediaId: item.id, ...(item.mediaType === 'tv' ? { seasons: chosen } : {}) },
      {
        onSuccess: () =>
          toast({
            title: `${title} requested`,
            description: me?.autoApprove[type]
              ? 'It will show up in your library once it has downloaded.'
              : 'It is waiting for an admin to approve it.',
            variant: 'success',
          }),
        onError: (e) => toast({ title: 'Request failed', description: e.message, variant: 'error' }),
      },
    )
  }

  const year = discoverYear(item)
  const facts =
    item.mediaType === 'movie'
      ? [year, item.runtime ? formatMinutes(item.runtime) : null]
      : [year, item.numberOfSeasons ? `${item.numberOfSeasons} ${item.numberOfSeasons === 1 ? 'season' : 'seasons'}` : null]

  return (
    <article className="flex flex-col gap-8">
      <header className="relative isolate h-[clamp(18rem,44vh,28rem)] overflow-hidden rounded-xl bg-surface">
        {backdrop && <img src={backdrop} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="hero-scrim absolute inset-0" />

        <div className="relative flex h-full max-w-2xl flex-col justify-end gap-3 p-5 md:p-8">
          <div className="flex items-center gap-3">
            <TypeTag type={type} />
            <StandingBadge standing={standing} />
          </div>
          <h1 className="text-3xl leading-tight font-bold md:text-5xl">{title}</h1>
          {item.tagline && <p className="text-sm text-foreground/60 italic">{item.tagline}</p>}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {item.voteAverage ? <span className="font-semibold text-match">{item.voteAverage.toFixed(1)} TMDB</span> : null}
            <DotList parts={[...facts, ...item.genres.slice(0, 3).map((g) => g.name)]} />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {watchable && (
              <Link
                to={`/item/${jellyfinId}`}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Play className="size-4 fill-current" />
                Watch
              </Link>
            )}
            {askable && (
              <button
                type="button"
                onClick={submit}
                disabled={request.isPending || (item.mediaType === 'tv' && picked.size === 0)}
                className={cn(
                  'inline-flex h-10 items-center gap-2 rounded-md px-5 text-sm font-semibold transition-colors disabled:opacity-50',
                  watchable
                    ? 'bg-white/10 backdrop-blur-sm hover:bg-white/20'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <Plus className="size-4" />
                {request.isPending
                  ? 'Requesting…'
                  : item.mediaType === 'tv'
                    ? picked.size === requestable.length && !seasons.size
                      ? 'Request series'
                      : `Request ${picked.size} ${picked.size === 1 ? 'season' : 'seasons'}`
                    : 'Request'}
              </button>
            )}
            {ownPending && (
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(ownPending.id, {
                    onSuccess: () => toast({ title: 'Request withdrawn' }),
                    onError: (e) => toast({ title: 'Could not withdraw it', description: e.message, variant: 'error' }),
                  })
                }
                className="inline-flex h-10 items-center gap-2 rounded-md bg-white/10 px-5 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-white/20 disabled:opacity-50"
              >
                <X className="size-4" />
                Withdraw request
              </button>
            )}
            {me && !canAsk && standing === 'none' && (
              <p className="text-sm text-muted-foreground">Your account cannot request {type === 'movie' ? 'films' : 'series'}.</p>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-8 md:flex-row">
        {poster && <img src={poster} alt="" className="hidden w-40 shrink-0 self-start rounded-lg shadow-card md:block" />}

        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          {item.overview && <p className="text-sm leading-relaxed text-foreground/80">{item.overview}</p>}

          {Boolean(item.credits?.cast.length) && (
            <Section title="Cast">
              <p className="text-sm text-muted-foreground">
                {item.credits?.cast.slice(0, 8).map((p) => p.name).join(', ')}
              </p>
            </Section>
          )}

          {item.mediaType === 'tv' && (
            <SeasonPicker
              item={item}
              standings={seasons}
              picked={picked}
              selectable={askable}
              onToggle={(n) =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (next.has(n)) next.delete(n)
                  else next.add(n)
                  return next
                })
              }
            />
          )}
        </div>
      </div>

      <DiscoverRow title="More like this" results={related} />
    </article>
  )
}

/** Season 0 is TMDB's "Specials": Sonarr rarely finds them, so they are not offered. */
const realSeasons = (item: TvDetails) => item.seasons.filter((s) => s.seasonNumber > 0)

const SEASON_LABEL: Record<SeasonStanding, string> = {
  available: 'In library',
  processing: 'Downloading',
  pending: 'Awaiting approval',
}

function SeasonPicker({
  item,
  standings,
  picked,
  selectable,
  onToggle,
}: {
  item: TvDetails
  standings: Map<number, SeasonStanding>
  picked: Set<number>
  selectable: boolean
  onToggle: (seasonNumber: number) => void
}) {
  const seasons = realSeasons(item)
  if (!seasons.length) return null
  return (
    <Section title="Seasons">
      <ul className="flex flex-col gap-1">
        {seasons.map((s) => {
          const standing = standings.get(s.seasonNumber)
          const free = !standing && selectable
          const on = picked.has(s.seasonNumber)
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!free}
                onClick={() => onToggle(s.seasonNumber)}
                aria-pressed={free ? on : undefined}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors enabled:hover:bg-surface disabled:cursor-default"
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-sm ring-1',
                    standing === 'available'
                      ? 'bg-match ring-match text-background'
                      : free && on
                        ? 'bg-primary ring-primary text-primary-foreground'
                        : 'ring-white/25',
                  )}
                >
                  {(standing === 'available' || (free && on)) && <Check className="size-3" />}
                </span>
                <span className="font-medium">{s.name}</span>
                <DotList
                  parts={[`${s.episodeCount} ${s.episodeCount === 1 ? 'episode' : 'episodes'}`, s.airDate?.slice(0, 4)]}
                  className="text-xs"
                />
                {standing && <span className="ml-auto text-xs text-muted-foreground">{SEASON_LABEL[standing]}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Info className="size-3.5 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </section>
  )
}

function formatMinutes(total: number) {
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h ${m}m` : `${m}m`
}
