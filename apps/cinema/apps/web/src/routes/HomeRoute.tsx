import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { FeatureCard } from '@/components/media/FeatureCard'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaRow, SectionHeading } from '@/components/media/MediaRow'
import {
  useLatestItems,
  useNextUp,
  useResumeItems,
  useSuggestions,
  useUserViews,
} from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

/** Four cards in the pager, two beside it -- the band is full at six. */
const BAND_SIZE = 6

export function HomeRoute() {
  const views = useUserViews()
  const resume = useResumeItems()
  const nextUp = useNextUp()
  const latest = useLatestItems()
  const suggested = useSuggestions()

  // What you were watching leads, then what is queued, then the newest
  // arrivals, then anything at all -- a library imported in one go has no
  // meaningful "latest", and the feature row must never be empty.
  const featured = dedupe([
    ...(resume.data ?? []),
    ...(nextUp.data ?? []),
    ...(latest.data ?? []),
    ...(suggested.data ?? []),
  ])

  const hero = featured.slice(0, BAND_SIZE - 2)
  const beside = featured.slice(BAND_SIZE - 2, BAND_SIZE)

  // The skeleton stands in until the band can be drawn once. `&&` dismissed it
  // as soon as the fastest query landed, so the band appeared with one card and
  // reflowed as the rest arrived; gate on what the band actually needs, and let
  // a full band end the wait even if a slower query is still in flight.
  const loading =
    featured.length < BAND_SIZE &&
    (resume.isLoading || nextUp.isLoading || latest.isLoading || suggested.isLoading)

  return (
    <div className="flex flex-col gap-9">
      <section className="flex flex-col gap-3">
        <SectionHeading to={views.data?.[0]?.Id ? `/library/${views.data[0].Id}` : undefined}>
          {resume.data?.length ? 'Continue watching' : 'Featured'}
        </SectionHeading>

        {/*
          The feature card and the two cards beside it share one row height, so
          the top of the page reads as a single band of artwork rather than
          three boxes that happen to be adjacent.
        */}
        <div
          className={cn(
            'grid h-[clamp(15rem,34vw,23rem)] gap-3',
            beside.length === 2
              ? 'md:grid-cols-[2fr_1fr_1fr]'
              : beside.length === 1
                ? 'md:grid-cols-[2fr_1fr]'
                : 'grid-cols-1',
          )}
        >
          {loading ? (
            <StickerSkeleton className="size-full rounded-xl" />
          ) : (
            <>
              <FeatureCard items={hero} className="h-full" />
              {beside.map((item) => (
                <MediaCard
                  key={item.Id}
                  item={item}
                  fill
                  className="hidden md:block"
                />
              ))}
            </>
          )}
        </div>
      </section>

      <MediaRow
        title="New & popular"
        items={firstNonEmpty(latest.data, suggested.data)}
        isLoading={latest.isLoading && suggested.isLoading}
      />

      <MediaRow
        title="Next up"
        items={nextUp.data}
        isLoading={nextUp.isLoading}
        shape="thumb"
      />

      {/* One row per library, so a big collection still feels ordered. */}
      {views.data?.map((view) => (
        <LibraryLatestRow key={view.Id} viewId={view.Id as string} name={view.Name ?? ''} />
      ))}
    </div>
  )
}

function LibraryLatestRow({ viewId, name }: { viewId: string; name: string }) {
  const { data, isLoading } = useLatestItems(viewId)
  return (
    <MediaRow title={name} items={data} isLoading={isLoading} seeAllTo={`/library/${viewId}`} />
  )
}

function firstNonEmpty(...lists: (BaseItemDto[] | undefined)[]) {
  return lists.find((list) => list?.length) ?? []
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
