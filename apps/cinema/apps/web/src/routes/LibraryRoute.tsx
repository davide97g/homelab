import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { Clapperboard, HardDriveDownload, RotateCcw } from 'lucide-react'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { MediaCard } from '@/components/media/MediaCard'
import { useAvailability } from '@/lib/jellyfin/availability'
import { useItems, useUserViews } from '@/lib/jellyfin/queries'
import { cn } from '@/lib/utils'

const SORTS = [
  { label: 'A–Z', by: ItemSortBy.SortName, order: SortOrder.Ascending },
  { label: 'Newest', by: ItemSortBy.DateCreated, order: SortOrder.Descending },
  { label: 'Release', by: ItemSortBy.PremiereDate, order: SortOrder.Descending },
  { label: 'Rating', by: ItemSortBy.CommunityRating, order: SortOrder.Descending },
] as const

export function LibraryRoute() {
  const { viewId } = useParams<{ viewId: string }>()
  const [sortIndex, setSortIndex] = useState(0)
  const sort = SORTS[sortIndex]

  const { data: views } = useUserViews()
  const view = views?.find((v) => v.Id === viewId)

  const { data, isLoading } = useItems({
    parentId: viewId,
    sortBy: [sort.by],
    sortOrder: [sort.order],
    limit: 200,
  })

  // One byte against one film answers "is the disk behind this library there".
  // A library on a removable drive otherwise renders a full grid of posters
  // that all fail on click, because the artwork is served from Jellyfin's own
  // metadata folder and knows nothing about the missing media.
  const probeItem = data?.items[0]
  const { data: availability, refetch: recheck, isFetching: rechecking } = useAvailability(probeItem)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{view?.Name ?? 'Library'}</h1>
          {data && (
            <p className="pt-1 text-sm text-muted-foreground">{data.totalRecordCount} titles</p>
          )}
        </div>

        {/* Sorting is four words, not four buttons in a bordered group. */}
        <div role="radiogroup" aria-label="Sort" className="flex items-center gap-4 text-sm">
          {SORTS.map((option, index) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={index === sortIndex}
              onClick={() => setSortIndex(index)}
              className={cn(
                'transition-colors',
                index === sortIndex
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {availability === 'offline' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3"
        >
          <HardDriveDownload className="size-4 shrink-0 text-amber" />
          <p className="text-sm">
            <span className="font-semibold">Storage offline.</span>{' '}
            <span className="text-muted-foreground">
              These titles are catalogued but their files are not reachable — reconnect the drive
              they live on.
            </span>
          </p>
          <button
            type="button"
            disabled={rechecking}
            onClick={() => void recheck()}
            className="ml-auto inline-flex h-8 items-center gap-2 rounded-md bg-white/10 px-3 text-xs font-semibold transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            {rechecking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      )}

      {!isLoading && !data?.items.length ? (
        <div className="flex flex-col items-start gap-2 py-12">
          <Clapperboard className="size-8 text-muted-foreground" />
          <p className="pt-1 text-lg font-semibold">Nothing in this library yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Drop films into the folder Jellyfin watches, then let the library scan pick them up.
          </p>
          <Link
            to="/"
            className="mt-2 inline-flex h-9 items-center rounded-md bg-white/10 px-4 text-sm font-semibold transition-colors hover:bg-white/20"
          >
            Back home
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {isLoading
            ? Array.from({ length: 18 }).map((_, i) => (
                <StickerSkeleton key={i} shape="poster" delay={i * 50} className="rounded-lg" />
              ))
            : data?.items.map((item) => <MediaCard key={item.Id} item={item} />)}
        </div>
      )}
    </div>
  )
}
