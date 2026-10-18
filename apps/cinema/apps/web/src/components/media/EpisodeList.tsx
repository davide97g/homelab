import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'
import { useEpisodes, useSeasons } from '@/lib/jellyfin/queries'
import { formatRuntime } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'
import { SectionHeading } from './MediaRow'

type Props = {
  seriesId: string
  /** The season to open on: the episode being looked at, or the one Play would start. */
  initialSeasonId?: string
  /** Marked in the list, so an episode page shows where you are. */
  currentEpisodeId?: string
}

/**
 * Seasons as words, the way the library sorts are, then the chosen season's
 * episodes as rows. A series with one season gets no picker -- a single
 * option is not a choice.
 */
export function EpisodeList({ seriesId, initialSeasonId, currentEpisodeId }: Props) {
  const { data: seasons } = useSeasons(seriesId)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const seasonId =
    picked ??
    seasons?.find((season) => season.Id === initialSeasonId)?.Id ??
    seasons?.[0]?.Id ??
    undefined
  const { data: episodes, isLoading } = useEpisodes(seriesId, seasonId)

  if (seasons && !seasons.length) return null

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <SectionHeading>Episodes</SectionHeading>
        {seasons && seasons.length > 1 && (
          <div role="radiogroup" aria-label="Season" className="flex flex-wrap items-center gap-4 text-sm">
            {seasons.map((season) => (
              <button
                key={season.Id}
                type="button"
                role="radio"
                aria-checked={season.Id === seasonId}
                onClick={() => setPicked(season.Id ?? undefined)}
                className={cn(
                  'transition-colors',
                  season.Id === seasonId
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {season.Name}
              </button>
            ))}
          </div>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        {isLoading || !episodes
          ? Array.from({ length: 4 }).map((_, i) => (
              <li key={i}>
                <StickerSkeleton shape="video" delay={i * 80} className="h-24 w-full rounded-lg" />
              </li>
            ))
          : episodes.map((episode) => (
              <li key={episode.Id}>
                <EpisodeRow episode={episode} current={episode.Id === currentEpisodeId} />
              </li>
            ))}
      </ol>
    </section>
  )
}

function EpisodeRow({ episode, current }: { episode: BaseItemDto; current: boolean }) {
  const { api } = useAuth()
  const still = itemImageUrl(api, episode, ImageType.Primary, { maxWidth: 480 })
  const progress = episode.UserData?.PlayedPercentage ?? 0
  const played = Boolean(episode.UserData?.Played)

  return (
    <Link
      to={`/item/${episode.Id}`}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'group flex gap-4 rounded-lg p-2 outline-none transition-colors',
        'hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-foreground',
        current && 'bg-white/5 ring-1 ring-white/15',
      )}
    >
      <span className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-surface sm:w-44">
        {still && <img src={still} alt="" loading="lazy" className="size-full object-cover" />}
        {played && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-pill bg-black/70">
            <Check className="size-3" />
          </span>
        )}
        {progress > 0 && progress < 100 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <span className="block h-full bg-primary" style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-col gap-1 py-1">
        <span className="flex items-baseline gap-2 text-sm">
          {episode.IndexNumber != null && (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {episode.IndexNumber}
            </span>
          )}
          <span className="truncate font-semibold">{episode.Name}</span>
          {episode.RunTimeTicks ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRuntime(episode.RunTimeTicks)}
            </span>
          ) : null}
        </span>
        {episode.Overview && (
          <span className="line-clamp-2 text-xs leading-relaxed text-foreground/70">
            {episode.Overview}
          </span>
        )}
      </span>
    </Link>
  )
}
