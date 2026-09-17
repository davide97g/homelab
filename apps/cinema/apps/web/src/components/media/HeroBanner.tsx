import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Info, Play, Sparkles } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { QuackButton } from '@/components/ui/quack-button'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemBackdropUrl, itemImageUrl } from '@/lib/jellyfin/images'
import { formatRuntime } from '@/lib/jellyfin/ticks'

/**
 * The one big thing on the home screen: a glass-framed backdrop you can page
 * through. Artwork is the only full-bleed element in Nebula, and it is still
 * inside a radius -- the frame is the design.
 */
export function HeroBanner({ items, label = 'Popular' }: { items: BaseItemDto[]; label?: string }) {
  const { api } = useAuth()
  const [index, setIndex] = useState(0)

  const item = items[index]
  if (!item) return null

  const backdrop = itemBackdropUrl(api, item)
  const logo = itemImageUrl(api, item, ImageType.Logo, { maxWidth: 520 })
  const meta = [
    item.ProductionYear,
    item.OfficialRating,
    item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null,
  ].filter(Boolean)

  const step = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length)

  return (
    <section className="relative isolate h-[clamp(22rem,46vh,32rem)] overflow-hidden rounded-3xl shadow-panel">
      {backdrop && (
        // `key` restarts the fade on every page, so switching reads as a cut
        // rather than an image silently swapping underneath the text.
        <img
          key={backdrop}
          src={backdrop}
          alt=""
          className="absolute inset-0 size-full animate-[duck-rise_var(--duration-base)_var(--ease)] object-cover object-top"
        />
      )}
      {/* Left wash carries the copy; bottom wash seats the card on the page. */}
      <div className="absolute inset-0 bg-gradient-to-r from-canvas-deep via-canvas-deep/75 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-canvas-deep/90 via-transparent to-transparent" />
      <div className="absolute inset-0 rounded-3xl border border-[var(--hairline)]" />

      <div className="relative flex h-full max-w-2xl flex-col justify-end gap-3 p-6 md:p-9">
        <span className="flex w-fit items-center gap-1.5 rounded-pill bg-amber/15 px-3 py-1 text-xs font-semibold text-amber">
          <Sparkles className="size-3.5" />
          {label}
        </span>

        {logo ? (
          <img src={logo} alt={item.Name ?? ''} className="max-h-20 w-fit object-contain" />
        ) : (
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-5xl">{item.Name}</h1>
        )}

        {!!meta.length && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {meta.map((entry, i) => (
              <span key={entry} className="flex items-center gap-2">
                {i > 0 && <span className="size-1 rounded-full bg-muted-foreground/60" />}
                {entry}
              </span>
            ))}
          </p>
        )}

        {item.Overview && (
          <p className="line-clamp-2 max-w-xl text-sm leading-relaxed text-foreground/75">
            {item.Overview}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <QuackButton asChild size="lg" idle="breathe" className="rounded-pill">
            <Link to={`/play/${item.Id}`}>
              <Play className="fill-current" />
              Play
            </Link>
          </QuackButton>
          <QuackButton asChild size="lg" variant="outline" idle="none" className="rounded-pill">
            <Link to={`/item/${item.Id}`}>
              <Info />
              More info
            </Link>
          </QuackButton>
        </div>

        {items.length > 1 && (
          <div className="mt-2 flex items-center gap-2">
            <PagerButton label="Previous" onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </PagerButton>
            <PagerButton label="Next" onClick={() => step(1)}>
              <ChevronRight className="size-4" />
            </PagerButton>
            <span className="ml-1 text-xs text-muted-foreground tabular-nums">
              {index + 1}/{items.length}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function PagerButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-9 place-items-center rounded-pill border border-[var(--hairline)] bg-white/5 text-foreground/80 backdrop-blur transition-colors hover:bg-white/12 hover:text-foreground"
    >
      {children}
    </button>
  )
}
