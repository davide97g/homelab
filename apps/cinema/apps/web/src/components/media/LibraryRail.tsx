import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'
import { formatRuntime } from '@/lib/jellyfin/ticks'

type Props = {
  title: string
  items: BaseItemDto[] | undefined
  isLoading?: boolean
  limit?: number
}

/**
 * The right-hand list: a dense, text-first counterpart to the artwork grid.
 * Each row's action is Play, not "open" -- this column exists to get you into
 * something in one click.
 */
export function LibraryRail({ title, items, isLoading, limit = 6 }: Props) {
  if (!isLoading && !items?.length) return null

  return (
    <aside className="panel flex flex-col gap-3 rounded-3xl p-4">
      <h2 className="px-1 text-base font-bold tracking-tight">{title}</h2>

      <div className="flex flex-col gap-1">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <StickerSkeleton key={i} delay={i * 90} className="h-16 rounded-2xl" />
            ))
          : items?.slice(0, limit).map((item) => <RailRow key={item.Id} item={item} />)}
      </div>
    </aside>
  )
}

function RailRow({ item }: { item: BaseItemDto }) {
  const { api } = useAuth()
  const poster = itemImageUrl(api, item, ImageType.Primary, { maxWidth: 120 })
  const title = item.Type === 'Episode' ? item.SeriesName : item.Name
  const chips =
    item.Type === 'Episode'
      ? [`S${item.ParentIndexNumber} E${item.IndexNumber}`]
      : (item.Genres?.slice(0, 2) ?? [])
  const runtime = item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null

  return (
    <div className="group flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-surface-2/70">
      <Link
        to={`/item/${item.Id}`}
        className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-surface-2"
      >
        {poster && <img src={poster} alt="" loading="lazy" className="size-full object-cover" />}
      </Link>

      <div className="min-w-0 flex-1">
        <Link to={`/item/${item.Id}`} className="block truncate text-sm font-semibold">
          {title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-pill bg-white/8 px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
            >
              {chip}
            </span>
          ))}
          {runtime && <span className="text-[0.6875rem] text-muted-foreground">{runtime}</span>}
        </div>
      </div>

      <Link
        to={`/play/${item.Id}`}
        aria-label={`Play ${title ?? 'item'}`}
        className="grid size-9 shrink-0 place-items-center rounded-pill bg-surface-2 text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
      >
        <Play className="size-4 translate-x-px fill-current" />
      </Link>
    </div>
  )
}
