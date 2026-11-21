import { memo, useState, type CSSProperties } from 'react'
import { thumbUrl } from '@/lib/api/client'
import type { AssetMediaSize } from '@/lib/api/types'
import { thumbhashUrl } from '@/lib/thumbhash'
import { cn } from '@/lib/cn'

/**
 * Cover-cropped asset image: placeholder colour -> thumbhash -> real image fading in.
 */
export const Thumb = memo(function Thumb({
  id,
  thumbhash,
  size = 'thumbnail',
  className,
  style,
  alt = '',
  eager,
}: {
  id: string | null | undefined
  thumbhash?: string | null
  size?: AssetMediaSize
  className?: string
  style?: CSSProperties
  alt?: string
  eager?: boolean
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const ph = thumbhashUrl(thumbhash)
  return (
    <div className={cn(!/\b(absolute|fixed)\b/.test(className ?? '') && 'relative', 'overflow-hidden bg-placeholder', className)} style={style}>
      {ph && <img src={ph} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />}
      {id && (
        <img
          key={id}
          src={thumbUrl(id, size, thumbhash)}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(id)}
          data-loaded={loaded === id ? '' : undefined}
          className="fade-img absolute inset-0 size-full object-cover"
        />
      )}
    </div>
  )
})
