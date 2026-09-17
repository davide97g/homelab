import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerCarousel } from '@/components/ui/sticker-carousel'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { MediaCard } from './MediaCard'

type Props = {
  title: string
  items: BaseItemDto[] | undefined
  isLoading?: boolean
  shape?: 'poster' | 'thumb'
}

export function MediaRow({ title, items, isLoading, shape = 'poster' }: Props) {
  if (!isLoading && !items?.length) return null

  return (
    <StickerCarousel
      title={title}
      // The page gutter goes on the wrapper rather than via `peek`, which pads
      // the track only -- that would leave the row heading a rem to the left of
      // the first poster.
      className="px-6 md:px-10"
    >
      {isLoading
        ? // One shared shimmer wave, staggered: reads as a row arriving rather
          // than eight things loading separately.
          Array.from({ length: 8 }).map((_, i) => (
            <StickerSkeleton
              key={i}
              shape={shape === 'thumb' ? 'video' : 'poster'}
              delay={i * 90}
              className={shape === 'thumb' ? 'w-[280px]' : 'w-[160px]'}
            />
          ))
        : items?.map((item) => <MediaCard key={item.Id} item={item} shape={shape} />)}
    </StickerCarousel>
  )
}
