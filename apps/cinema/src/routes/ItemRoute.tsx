import { Link, useParams } from 'react-router-dom'
import { HardDriveDownload, Play, RotateCcw } from 'lucide-react'
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type'
import { HoloBadge } from '@/components/ui/holo-badge'
import { HoloButton } from '@/components/ui/holo-button'
import { QuackButton } from '@/components/ui/quack-button'
import {
  StickerCard,
  StickerCardContent,
  StickerCardHeader,
  StickerCardTitle,
} from '@/components/ui/sticker-card'
import { StickerSkeleton, StickerSkeletonText } from '@/components/ui/sticker-skeleton'
import { useAuth } from '@/lib/jellyfin/auth'
import { useAvailability } from '@/lib/jellyfin/availability'
import { ImageType, itemBackdropUrl, itemImageUrl } from '@/lib/jellyfin/images'
import { useItem } from '@/lib/jellyfin/queries'
import { formatRuntime, ticksToSeconds } from '@/lib/jellyfin/ticks'
import { formatTimecode } from '@/lib/jellyfin/ticks'

export function ItemRoute() {
  const { itemId } = useParams<{ itemId: string }>()
  const { api } = useAuth()
  const { data: item, isLoading } = useItem(itemId)
  // Called before the loading return, so it keeps its hook slot; it stays
  // disabled until there is an item to probe.
  const { data: availability, refetch: recheck, isFetching: rechecking } = useAvailability(item)

  if (isLoading || !item) {
    return (
      <div className="space-y-6 px-6 pt-24 md:px-10">
        <StickerSkeleton className="h-[45vh] w-full rounded-2xl" />
        <StickerSkeleton shape="title" delay={90} />
        <StickerSkeletonText className="max-w-2xl" lines={4} />
      </div>
    )
  }

  const backdrop = itemBackdropUrl(api, item)
  const poster = itemImageUrl(api, item, ImageType.Primary, { maxWidth: 400 })
  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0
  const source = item.MediaSources?.[0]
  const video = source?.MediaStreams?.find((s) => s.Type === MediaStreamType.Video)
  const audioTracks = source?.MediaStreams?.filter((s) => s.Type === MediaStreamType.Audio) ?? []
  const subtitles = source?.MediaStreams?.filter((s) => s.Type === MediaStreamType.Subtitle) ?? []
  // Jellyfin happily serves metadata for a film whose disk is unplugged, so
  // the page has to find that out for itself before offering a Play button.
  const offline = availability === 'offline'

  return (
    <article>
      <div className="relative h-[45vh] min-h-[300px] w-full overflow-hidden">
        {backdrop && <img src={backdrop} alt="" className="size-full object-cover object-top" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>

      <div className="relative -mt-32 flex flex-col gap-8 px-6 md:flex-row md:px-10">
        {poster && (
          <img
            src={poster}
            alt={item.Name ?? ''}
            className="sticker w-44 shrink-0 self-start rounded-2xl border-border duck-glow-primary"
          />
        )}

        <div className="max-w-3xl space-y-5">
          <div className="space-y-2">
            <h1 className="font-display text-4xl font-bold tracking-tight">{item.Name}</h1>
            {item.Taglines?.[0] && (
              <p className="text-sm text-muted-foreground italic">{item.Taglines[0]}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {item.ProductionYear && <span>{item.ProductionYear}</span>}
            {item.OfficialRating && <HoloBadge variant="outline">{item.OfficialRating}</HoloBadge>}
            {item.RunTimeTicks && <span>{formatRuntime(item.RunTimeTicks)}</span>}
            {item.CommunityRating && (
              <HoloBadge variant="success">★ {item.CommunityRating.toFixed(1)}</HoloBadge>
            )}
            {item.Genres?.map((g) => (
              <HoloBadge key={g} variant="muted">
                {g}
              </HoloBadge>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            {/* Whichever action continues the film gets the page's one holo
                element; the alternative next to it stays a plain sticker.
                Offline storage takes the slot instead: an enabled Play button
                that leads to a 404 is worse than no button. */}
            {offline ? (
              <div className="flex flex-wrap items-center gap-3">
                <HoloBadge variant="danger">
                  <HardDriveDownload />
                  Storage offline
                </HoloBadge>
                <span className="text-sm text-muted-foreground">
                  This file lives on a drive the server cannot reach.
                </span>
                <QuackButton
                  variant="outline"
                  size="sm"
                  disabled={rechecking}
                  onClick={() => void recheck()}
                >
                  <RotateCcw />
                  {rechecking ? 'Checking…' : 'Check again'}
                </QuackButton>
              </div>
            ) : resumeTicks > 0 ? (
              <>
                <HoloButton asChild size="lg" variant="holo">
                  <Link to={`/play/${item.Id}?t=${Math.floor(ticksToSeconds(resumeTicks))}`}>
                    <Play className="fill-current" />
                    Resume at {formatTimecode(ticksToSeconds(resumeTicks))}
                  </Link>
                </HoloButton>
                <QuackButton asChild size="lg" variant="outline">
                  <Link to={`/play/${item.Id}`}>
                    <RotateCcw />
                    Start over
                  </Link>
                </QuackButton>
              </>
            ) : (
              <HoloButton asChild size="lg" variant="holo">
                <Link to={`/play/${item.Id}`}>
                  <Play className="fill-current" />
                  Play
                </Link>
              </HoloButton>
            )}
          </div>

          {item.Overview && (
            <p className="text-sm leading-relaxed text-foreground/80">{item.Overview}</p>
          )}

          {Boolean(item.People?.length) && (
            <div className="space-y-1.5">
              <h2 className="font-display text-sm font-bold">Cast</h2>
              <p className="text-sm text-muted-foreground">
                {item.People?.slice(0, 8).map((p) => p.Name).join(', ')}
              </p>
            </div>
          )}

          {/* Your direct-play diagnostic panel. If the container is mkv and the
              audio is TrueHD, expect a transcode in the browser -- and you will
              see exactly that in the player badge. */}
          {source && (
            <StickerCard className="gap-3 p-4">
              <StickerCardHeader>
                <StickerCardTitle className="text-sm">Media</StickerCardTitle>
              </StickerCardHeader>
              <StickerCardContent>
                <dl className="grid gap-x-6 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                  <Row label="Container" value={source.Container?.toUpperCase()} />
                  <Row
                    label="Size"
                    value={source.Size ? `${(source.Size / 1024 ** 3).toFixed(2)} GB` : undefined}
                  />
                  <Row label="Video" value={video?.DisplayTitle ?? undefined} />
                  <Row
                    label="Bitrate"
                    value={
                      source.Bitrate ? `${Math.round(source.Bitrate / 1_000_000)} Mbps` : undefined
                    }
                  />
                  <Row
                    label="Audio"
                    value={audioTracks.map((a) => a.DisplayTitle).filter(Boolean).join(' · ')}
                  />
                  <Row
                    label="Subtitles"
                    value={
                      subtitles.length
                        ? subtitles.map((s) => s.Language ?? s.DisplayTitle).join(', ')
                        : 'None'
                    }
                  />
                </dl>
              </StickerCardContent>
            </StickerCard>
          )}
        </div>
      </div>
    </article>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-medium text-foreground/70">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  )
}
