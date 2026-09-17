import { Link } from 'react-router-dom'
import { Info, Play } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { HoloButton } from '@/components/ui/holo-button'
import { QuackButton } from '@/components/ui/quack-button'
import { HoloBadge } from '@/components/ui/holo-badge'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemBackdropUrl, itemImageUrl } from '@/lib/jellyfin/images'
import { formatRuntime } from '@/lib/jellyfin/ticks'

export function HeroBanner({ item }: { item: BaseItemDto }) {
  const { api } = useAuth()
  const backdrop = itemBackdropUrl(api, item)
  const logo = itemImageUrl(api, item, ImageType.Logo, { maxWidth: 480 })

  return (
    <header className="relative h-[62vh] min-h-[420px] w-full overflow-hidden">
      {backdrop && (
        <img src={backdrop} alt="" className="absolute inset-0 size-full object-cover object-top" />
      )}
      {/* Two gradients: one to lift text off the image, one to melt the
          bottom edge into the first carousel. */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />

      <div className="relative flex h-full max-w-2xl flex-col justify-end gap-4 px-6 pb-16 md:px-10">
        {logo ? (
          <img src={logo} alt={item.Name ?? ''} className="max-h-24 w-fit object-contain" />
        ) : (
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-6xl">
            {item.Name}
          </h1>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {item.ProductionYear && <span>{item.ProductionYear}</span>}
          {item.OfficialRating && <HoloBadge variant="outline">{item.OfficialRating}</HoloBadge>}
          {item.RunTimeTicks && <span>{formatRuntime(item.RunTimeTicks)}</span>}
          {item.Genres?.slice(0, 3).map((g) => (
            <HoloBadge key={g} variant="muted">
              {g}
            </HoloBadge>
          ))}
        </div>

        {item.Overview && (
          <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-foreground/80">
            {item.Overview}
          </p>
        )}

        <div className="mt-2 flex gap-3">
          {/* Play is the most important thing on the home screen, so it gets
              the viewport's one holo element -- and the animated border is
              also its one idle animation. */}
          <HoloButton asChild size="lg" variant="holo">
            <Link to={`/play/${item.Id}`}>
              <Play className="fill-current" />
              Play
            </Link>
          </HoloButton>
          <QuackButton asChild size="lg" variant="outline" idle="none">
            <Link to={`/item/${item.Id}`}>
              <Info />
              More info
            </Link>
          </QuackButton>
        </div>
      </div>
    </header>
  )
}
