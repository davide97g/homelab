import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerMediaCard } from '@/components/ui/sticker-media-card'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'
import { formatRuntime } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'

type Props = {
  item: BaseItemDto
  /** 'poster' for browsing, 'thumb' for Continue Watching. */
  shape?: 'poster' | 'thumb'
  className?: string
}

export function MediaCard({ item, shape = 'poster', className }: Props) {
  const { api } = useAuth()
  const isThumb = shape === 'thumb'

  const imageUrl = itemImageUrl(
    api,
    item,
    isThumb ? ImageType.Backdrop : ImageType.Primary,
    { maxWidth: isThumb ? 480 : 320 },
  )

  const progress = item.UserData?.PlayedPercentage ?? 0
  const subtitle =
    item.Type === 'Episode'
      ? `S${item.ParentIndexNumber} E${item.IndexNumber}`
      : [item.ProductionYear, formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' · ')

  return (
    <StickerMediaCard
      asChild
      src={imageUrl}
      aspect={isThumb ? '16/9' : '2/3'}
      title={item.Type === 'Episode' ? item.SeriesName : item.Name}
      subtitle={subtitle || undefined}
      fallback={item.Name ?? undefined}
      // Only mid-watch films get a bar. 0% and 100% are not progress.
      progress={progress > 0 && progress < 100 ? progress : undefined}
      overlay={
        <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground duck-glow-primary">
          <Play className="size-5 translate-x-px fill-current" />
        </span>
      }
      className={cn('shrink-0', isThumb ? 'w-[280px]' : 'w-[160px]', className)}
    >
      <Link to={`/item/${item.Id}`} />
    </StickerMediaCard>
  )
}
