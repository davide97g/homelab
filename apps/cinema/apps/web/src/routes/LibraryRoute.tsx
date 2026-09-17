import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { Clapperboard, HardDriveDownload, RotateCcw } from 'lucide-react'
import { EmptyPond } from '@/components/ui/empty-pond'
import { QuackButton } from '@/components/ui/quack-button'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import {
  StickerToggleGroup,
  StickerToggleGroupItem,
} from '@/components/ui/sticker-toggle-group'
import { MediaCard } from '@/components/media/MediaCard'
import { useAvailability } from '@/lib/jellyfin/availability'
import { useItems, useUserViews } from '@/lib/jellyfin/queries'

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
  // that all fail on click, because the artwork is served from Jellyfin's
  // own metadata folder and knows nothing about the missing media.
  const probeItem = data?.items[0]
  const { data: availability, refetch: recheck, isFetching: rechecking } =
    useAvailability(probeItem)

  return (
    <div className="flex flex-col gap-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {view?.Name ?? 'Library'}
          </h1>
          {data && <p className="text-sm text-muted-foreground">{data.totalRecordCount} titles</p>}
        </div>
        {/* Single-select, so the group renders as radios: a reader announces
            "Newest, radio button, 2 of 4" instead of four pressed buttons. */}
        <StickerToggleGroup
          type="single"
          size="sm"
          aria-label="Sort"
          value={String(sortIndex)}
          onValueChange={(value) => value && setSortIndex(Number(value))}
        >
          {SORTS.map((option, index) => (
            <StickerToggleGroupItem key={option.label} value={String(index)}>
              {option.label}
            </StickerToggleGroupItem>
          ))}
        </StickerToggleGroup>
      </div>

      {availability === 'offline' && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <HardDriveDownload className="size-5 shrink-0 text-destructive" />
          <p className="text-sm text-foreground/80">
            <span className="font-semibold text-foreground">Storage offline.</span>{' '}
            These titles are catalogued but their files are not reachable — reconnect the drive
            they live on.
          </p>
          <QuackButton
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={rechecking}
            onClick={() => void recheck()}
          >
            <RotateCcw />
            {rechecking ? 'Checking…' : 'Check again'}
          </QuackButton>
        </div>
      )}

      {!isLoading && !data?.items.length ? (
        <EmptyPond
          // The art slot keeps the pond -- ripples, copy hierarchy, action --
          // and swaps the mascot for something on-domain.
          art={<Clapperboard className="relative size-14 text-primary" />}
          title="Nothing in this library yet"
          hint="Drop films into the folder Jellyfin watches, then let the library scan pick them up."
          action={
            <QuackButton asChild variant="outline">
              <Link to="/">Back home</Link>
            </QuackButton>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-8">
          {isLoading
            ? Array.from({ length: 18 }).map((_, i) => (
                <StickerSkeleton key={i} shape="poster" delay={i * 60} />
              ))
            : data?.items.map((item) => (
                <MediaCard key={item.Id} item={item} className="w-full" />
              ))}
        </div>
      )}
    </div>
  )
}
