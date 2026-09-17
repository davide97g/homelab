import { Link } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { HeroBanner } from '@/components/media/HeroBanner'
import { LibraryRail } from '@/components/media/LibraryRail'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaRow } from '@/components/media/MediaRow'
import { useLatestItems, useNextUp, useResumeItems, useUserViews } from '@/lib/jellyfin/queries'

export function HomeRoute() {
  const views = useUserViews()
  const resume = useResumeItems()
  const nextUp = useNextUp()
  const latest = useLatestItems()

  // What you were watching leads; the newest arrivals fill the rest of the
  // pager. Deduped, because a film can legitimately be in both.
  const hero = dedupe([...(resume.data ?? []), ...(latest.data ?? [])]).slice(0, 5)
  const suggestions = dedupe(latest.data ?? [])
    .filter((item) => !hero.some((h) => h.Id === item.Id))
    .slice(0, 4)

  return (
    <div className="flex flex-col gap-7">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {hero.length ? (
            <HeroBanner items={hero} label={resume.data?.length ? 'Pick up where you left' : 'Popular'} />
          ) : (
            <StickerSkeleton className="h-[clamp(22rem,46vh,32rem)] w-full rounded-3xl" />
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold tracking-tight">You might also like</h2>
              {views.data?.[0]?.Id && (
                <Link
                  to={`/library/${views.data[0].Id}`}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary-soft"
                >
                  See all
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {latest.isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <StickerSkeleton key={i} shape="poster" delay={i * 90} className="rounded-2xl" />
                  ))
                : suggestions.map((item) => (
                    <MediaCard key={item.Id} item={item} className="w-full" />
                  ))}
            </div>
          </section>
        </div>

        <LibraryRail
          title="In library"
          items={nextUp.data?.length ? nextUp.data : latest.data}
          isLoading={nextUp.isLoading && latest.isLoading}
        />
      </div>

      <MediaRow
        title="Continue watching"
        items={resume.data}
        isLoading={resume.isLoading}
        shape="thumb"
      />
      <MediaRow title="Next up" items={nextUp.data} isLoading={nextUp.isLoading} shape="thumb" />

      {/* One "latest" row per library, so a big collection still feels ordered. */}
      {views.data?.map((view) => (
        <LibraryLatestRow key={view.Id} viewId={view.Id as string} name={view.Name ?? ''} />
      ))}
    </div>
  )
}

function LibraryLatestRow({ viewId, name }: { viewId: string; name: string }) {
  const { data, isLoading } = useLatestItems(viewId)
  return (
    <MediaRow
      title={`New in ${name}`}
      items={data}
      isLoading={isLoading}
      seeAllTo={`/library/${viewId}`}
    />
  )
}

function dedupe(items: BaseItemDto[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = item.Id ?? ''
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
