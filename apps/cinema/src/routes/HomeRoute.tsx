import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { HeroBanner } from '@/components/media/HeroBanner'
import { MediaRow } from '@/components/media/MediaRow'
import { useLatestItems, useNextUp, useResumeItems, useUserViews } from '@/lib/jellyfin/queries'

export function HomeRoute() {
  const views = useUserViews()
  const resume = useResumeItems()
  const nextUp = useNextUp()
  const latest = useLatestItems()

  // Feature whatever you were last watching, else the newest arrival.
  const hero = resume.data?.[0] ?? latest.data?.[0]

  return (
    <div className="space-y-10">
      {hero ? (
        <HeroBanner item={hero} />
      ) : (
        <StickerSkeleton className="h-[62vh] min-h-[420px] w-full rounded-none" />
      )}

      <MediaRow
        title="Continue watching"
        items={resume.data}
        isLoading={resume.isLoading}
        shape="thumb"
      />
      <MediaRow title="Next up" items={nextUp.data} isLoading={nextUp.isLoading} shape="thumb" />
      <MediaRow title="Recently added" items={latest.data} isLoading={latest.isLoading} />

      {/* One "latest" row per library, so a big collection still feels ordered. */}
      {views.data?.map((view) => (
        <LibraryLatestRow key={view.Id} viewId={view.Id as string} name={view.Name ?? ''} />
      ))}
    </div>
  )
}

function LibraryLatestRow({ viewId, name }: { viewId: string; name: string }) {
  const { data, isLoading } = useLatestItems(viewId)
  return <MediaRow title={`New in ${name}`} items={data} isLoading={isLoading} />
}
