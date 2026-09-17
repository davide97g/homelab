import { Link, useParams } from 'react-router-dom'
import { HardDriveDownload, Info, Play, RotateCcw } from 'lucide-react'
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type'
import { StickerSkeleton, StickerSkeletonText } from '@/components/ui/sticker-skeleton'
import { matchPercent } from '@/components/media/item-facts'
import { DotList, KindTag } from '@/components/media/item-meta'
import { useAuth } from '@/lib/jellyfin/auth'
import { useAvailability } from '@/lib/jellyfin/availability'
import { ImageType, itemBackdropUrl, itemImageUrl } from '@/lib/jellyfin/images'
import { useItem } from '@/lib/jellyfin/queries'
import { formatRuntime, formatTimecode, ticksToSeconds } from '@/lib/jellyfin/ticks'

export function ItemRoute() {
  const { itemId } = useParams<{ itemId: string }>()
  const { api } = useAuth()
  const { data: item, isLoading } = useItem(itemId)
  // Called before the loading return, so it keeps its hook slot; it stays
  // disabled until there is an item to probe.
  const { data: availability, refetch: recheck, isFetching: rechecking } = useAvailability(item)

  if (isLoading || !item) {
    return (
      <div className="flex flex-col gap-6">
        <StickerSkeleton className="h-[42vh] w-full rounded-xl" />
        <StickerSkeleton shape="title" delay={80} />
        <StickerSkeletonText className="max-w-2xl" lines={4} />
      </div>
    )
  }

  const backdrop = itemBackdropUrl(api, item)
  const poster = itemImageUrl(api, item, ImageType.Primary, { maxWidth: 400 })
  const logo = itemImageUrl(api, item, ImageType.Logo, { maxWidth: 480 })
  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0
  const source = item.MediaSources?.[0]
  const video = source?.MediaStreams?.find((s) => s.Type === MediaStreamType.Video)
  const audioTracks = source?.MediaStreams?.filter((s) => s.Type === MediaStreamType.Audio) ?? []
  const subtitles = source?.MediaStreams?.filter((s) => s.Type === MediaStreamType.Subtitle) ?? []
  const match = matchPercent(item)
  // Jellyfin happily serves metadata for a film whose disk is unplugged, so
  // the page has to find that out for itself before offering a Play button.
  const offline = availability === 'offline'

  return (
    <article className="flex flex-col gap-8">
      <header className="relative isolate h-[clamp(18rem,44vh,28rem)] overflow-hidden rounded-xl bg-surface">
        {backdrop && <img src={backdrop} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="hero-scrim absolute inset-0" />

        <div className="relative flex h-full max-w-2xl flex-col justify-end gap-3 p-5 md:p-8">
          <KindTag item={item} />

          {logo ? (
            <img
              src={logo}
              alt={item.Name ?? ''}
              className="max-h-20 w-fit max-w-[75%] object-contain object-left md:max-h-24"
            />
          ) : (
            <h1 className="text-3xl leading-tight font-bold md:text-5xl">{item.Name}</h1>
          )}

          {item.Taglines?.[0] && (
            <p className="text-sm text-foreground/60 italic">{item.Taglines[0]}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {match != null && <span className="font-semibold text-match">{match}% match</span>}
            <DotList
              parts={[
                item.ProductionYear ? String(item.ProductionYear) : null,
                item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null,
                item.OfficialRating,
                ...(item.Genres?.slice(0, 3) ?? []),
              ]}
            />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {offline ? (
              <OfflineNotice rechecking={rechecking} onRecheck={() => void recheck()} />
            ) : resumeTicks > 0 ? (
              <>
                <PrimaryAction to={`/play/${item.Id}?t=${Math.floor(ticksToSeconds(resumeTicks))}`}>
                  <Play className="size-4 fill-current" />
                  Resume at {formatTimecode(ticksToSeconds(resumeTicks))}
                </PrimaryAction>
                <SecondaryAction to={`/play/${item.Id}`}>
                  <RotateCcw className="size-4" />
                  Start over
                </SecondaryAction>
              </>
            ) : (
              <PrimaryAction to={`/play/${item.Id}`}>
                <Play className="size-4 fill-current" />
                Play
              </PrimaryAction>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-8 md:flex-row">
        {poster && (
          <img
            src={poster}
            alt=""
            className="hidden w-40 shrink-0 self-start rounded-lg shadow-card md:block"
          />
        )}

        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          {item.Overview && (
            <p className="text-sm leading-relaxed text-foreground/80">{item.Overview}</p>
          )}

          {Boolean(item.People?.length) && (
            <Section title="Cast">
              <p className="text-sm text-muted-foreground">
                {item.People?.slice(0, 8).map((person) => person.Name).join(', ')}
              </p>
            </Section>
          )}

          {/* The direct-play diagnostic. If the container is mkv and the audio
              is TrueHD, expect a transcode in the browser -- and you will see
              exactly that in the player badge. */}
          {source && (
            <Section title="Media">
              <dl className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
                <Row label="Container" value={source.Container?.toUpperCase()} />
                <Row
                  label="Size"
                  value={source.Size ? `${(source.Size / 1024 ** 3).toFixed(2)} GB` : undefined}
                />
                <Row label="Video" value={video?.DisplayTitle ?? undefined} />
                <Row
                  label="Bitrate"
                  value={source.Bitrate ? `${Math.round(source.Bitrate / 1_000_000)} Mbps` : undefined}
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
            </Section>
          )}
        </div>
      </div>
    </article>
  )
}

function PrimaryAction({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {children}
    </Link>
  )
}

function SecondaryAction({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex h-10 items-center gap-2 rounded-md bg-white/10 px-5 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-white/20"
    >
      {children}
    </Link>
  )
}

/**
 * An enabled Play button that leads to a 404 is worse than no button, so the
 * unreachable-storage case takes the action slot rather than sitting beside it.
 */
function OfflineNotice({
  rechecking,
  onRecheck,
}: {
  rechecking: boolean
  onRecheck: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface/80 px-4 py-3 backdrop-blur-sm">
      <HardDriveDownload className="size-4 shrink-0 text-amber" />
      <p className="text-sm">
        <span className="font-semibold">Storage offline.</span>{' '}
        <span className="text-muted-foreground">
          This file lives on a drive the server cannot reach.
        </span>
      </p>
      <button
        type="button"
        disabled={rechecking}
        onClick={onRecheck}
        className="inline-flex h-8 items-center gap-2 rounded-md bg-white/10 px-3 text-xs font-semibold transition-colors hover:bg-white/20 disabled:opacity-50"
      >
        <RotateCcw className="size-3.5" />
        {rechecking ? 'Checking…' : 'Check again'}
      </button>
    </div>
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

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  )
}
