import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Play } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemBackdropUrl, itemImageUrl } from '@/lib/jellyfin/images'
import { cn } from '@/lib/utils'
import { displayTitle, factLine, matchPercent } from './item-facts'
import { DotList, KindTag } from './item-meta'

/**
 * The one large card on the home screen. It pages through a handful of items
 * on dots rather than arrows: at this size the artwork is the control, and a
 * pair of chevrons in the corner is chrome the layout does not need.
 */
export function FeatureCard({ items, className }: { items: BaseItemDto[]; className?: string }) {
  const { api } = useAuth()
  const [index, setIndex] = useState(0)

  const item = items[index]
  if (!item) return null

  const backdrop = itemBackdropUrl(api, item)
  const logo = itemImageUrl(api, item, ImageType.Logo, { maxWidth: 480 })
  const match = matchPercent(item)

  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-xl bg-surface shadow-card',
        className,
      )}
    >
      {backdrop && (
        // `key` restarts the fade on every page, so switching reads as a cut
        // rather than an image silently swapping underneath the text.
        <img
          key={backdrop}
          src={backdrop}
          alt=""
          // The largest thing above the fold, and so the LCP element: it has to
          // leave ahead of the card artwork below it, which is `loading="lazy"`.
          fetchPriority="high"
          className="absolute inset-0 size-full animate-[reel-fade_var(--duration-base)_var(--ease)] object-cover"
        />
      )}
      <div className="hero-scrim absolute inset-0" />

      <div className="relative flex h-full max-w-xl flex-col justify-end gap-3 p-5 md:p-7">
        <KindTag item={item} />

        {logo ? (
          <img
            src={logo}
            alt={item.Name ?? ''}
            className="max-h-16 w-fit max-w-[70%] object-contain object-left md:max-h-20"
          />
        ) : (
          <h1 className="text-2xl leading-tight font-bold md:text-4xl">{displayTitle(item)}</h1>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {match != null && <span className="font-semibold text-match">{match}% match</span>}
          <DotList
            parts={[...factLine(item), item.OfficialRating, ...(item.Genres?.slice(0, 2) ?? [])]}
          />
        </div>

        {item.Overview && (
          <p className="line-clamp-2 max-w-md text-sm leading-relaxed text-foreground/70">
            {item.Overview}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Link
            to={`/play/${item.Id}`}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Play className="size-4 fill-current" />
            Play
          </Link>
          <Link
            to={`/item/${item.Id}`}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-white/10 px-5 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <Info className="size-4" />
            More info
          </Link>
        </div>

        {items.length > 1 && (
          <div className="mt-1 flex items-center gap-1.5">
            {items.map((entry, i) => (
              <button
                key={entry.Id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show ${displayTitle(entry) ?? `item ${i + 1}`}`}
                aria-current={i === index}
                className={cn(
                  'h-1.5 rounded-pill transition-all duration-[var(--duration-base)]',
                  i === index ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/30 hover:bg-foreground/60',
                )}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
