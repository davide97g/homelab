import { useEffect, useState } from 'react'
import { Play, X } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'

const COUNTDOWN_SECONDS = 8

type Props = {
  episode: BaseItemDto
  onPlay: () => void
  onCancel: () => void
}

/**
 * The card an episode ends on. It counts down and plays the next one by
 * itself, because the person on the sofa has usually put the remote down;
 * cancelling leaves the last frame where it was.
 */
export function UpNext({ episode, onPlay, onCancel }: Props) {
  const { api } = useAuth()
  const [left, setLeft] = useState(COUNTDOWN_SECONDS)
  const still = itemImageUrl(api, episode, ImageType.Primary, { maxWidth: 480 })

  useEffect(() => {
    if (left <= 0) {
      onPlay()
      return
    }
    const timer = window.setTimeout(() => setLeft((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [left, onPlay])

  return (
    <div className="absolute right-4 bottom-24 flex w-[min(22rem,calc(100%-2rem))] flex-col gap-3 rounded-xl bg-black/85 p-4 shadow-card backdrop-blur-sm md:right-6 md:bottom-28">
      <p className="text-xs font-semibold tracking-[0.14em] text-white/60 uppercase">
        Next episode in {left}s
      </p>
      <div className="flex gap-3">
        {still && (
          <img src={still} alt="" className="aspect-video w-28 shrink-0 rounded-md object-cover" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{episode.Name}</p>
          <p className="text-xs text-white/60">
            {[
              episode.ParentIndexNumber != null ? `S${episode.ParentIndexNumber}` : null,
              episode.IndexNumber != null ? `E${episode.IndexNumber}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPlay}
          className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Play className="size-4 fill-current" />
          Play now
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-white/10 px-4 text-sm font-semibold transition-colors hover:bg-white/20"
        >
          <X className="size-4" />
          Cancel
        </button>
      </div>
    </div>
  )
}
