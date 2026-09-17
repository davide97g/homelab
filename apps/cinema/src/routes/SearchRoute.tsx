import { Link, useSearchParams } from 'react-router-dom'
import { FilmIcon } from 'lucide-react'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { EmptyPond } from '@/components/ui/empty-pond'
import { QuackButton } from '@/components/ui/quack-button'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { MediaCard } from '@/components/media/MediaCard'
import { useItems } from '@/lib/jellyfin/queries'

export function SearchRoute() {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''

  const { data, isLoading } = useItems(
    {
      searchTerm: query,
      includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode],
      limit: 60,
    },
    query.length > 0,
  )

  return (
    <div className="px-6 pt-24 md:px-10">
      <h1 className="mb-6 font-display text-2xl font-bold tracking-tight">
        Results for <span className="text-primary">{query}</span>
      </h1>

      {!isLoading && !data?.items.length ? (
        <EmptyPond
          art={<FilmIcon className="relative size-14 text-primary" />}
          title="Nothing matched that"
          hint="Try a shorter title, or the original-language one."
          action={
            <QuackButton asChild variant="outline">
              <Link to="/">Back home</Link>
            </QuackButton>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-8">
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => (
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
