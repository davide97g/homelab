import { Aperture, Calendar, Camera, Heart, MapPin, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { personThumbUrl } from '@/lib/api/client'
import type { AssetResponseDto } from '@/lib/api/types'
import { formatBytes, formatDay, formatTime, localDate, weekday } from '@/lib/format'
import type { TimelineAsset } from '@/features/timeline/store'
import { cn } from '@/lib/cn'

/** Info sheet (phone: bottom sheet; desktop: side panel). */
export function InfoPanel({
  asset,
  detail,
  loading,
  onClose,
  onFavorite,
}: {
  asset: TimelineAsset
  detail: AssetResponseDto | undefined
  loading: boolean
  onClose: () => void
  onFavorite: () => void
}) {
  const ex = detail?.exifInfo
  const when = localDate(asset.fileCreatedAt, asset.localOffsetHours)
  const mp = ex?.exifImageWidth && ex?.exifImageHeight ? ((ex.exifImageWidth * ex.exifImageHeight) / 1e6).toFixed(0) : null
  const specs = [
    ex?.iso ? `ISO ${ex.iso}` : null,
    ex?.focalLength ? `${Math.round(ex.focalLength)} mm` : null,
    ex?.fNumber ? `ƒ${ex.fNumber}` : null,
    ex?.exposureTime ? `${ex.exposureTime} s` : null,
  ].filter(Boolean)
  const hasGps = ex?.latitude != null && ex?.longitude != null

  return (
    <aside
      className="absolute inset-x-0 bottom-0 z-10 flex max-h-[58%] flex-col rounded-t-[22px] bg-[#1c1c1e] text-white shadow-2xl lg:static lg:max-h-none lg:w-[380px] lg:rounded-none lg:border-l lg:border-white/10"
      style={{ animation: 'sheet-in 280ms cubic-bezier(.2,.8,.2,1)' }}
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div>
          <div className="text-[17px] font-semibold">{weekday(when)}</div>
          <div className="text-[13px] text-white/60">
            {formatDay(when)} · {formatTime(when)}
          </div>
        </div>
        <div className="flex gap-2">
          <button aria-label="Favorite" onClick={onFavorite} className="flex size-9 items-center justify-center rounded-full bg-white/10">
            <Heart className={cn('size-[18px]', asset.isFavorite && 'fill-white')} />
          </button>
          <button aria-label="Close info" onClick={onClose} className="flex size-9 items-center justify-center rounded-full bg-white/10">
            <X className="size-[18px]" />
          </button>
        </div>
      </div>
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {ex?.description && <p className="px-1 text-[15px]">{ex.description}</p>}

        <section className="rounded-[14px] bg-white/[0.07]">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[13px]">
            <Camera className="size-4 text-white/60" />
            <span className="font-semibold">{[ex?.make, ex?.model].filter(Boolean).join(' ') || (loading ? 'Loading…' : 'Unknown camera')}</span>
          </div>
          <div className="space-y-0.5 px-4 py-2.5 text-[13px] text-white/70">
            {ex?.lensModel && (
              <div className="flex items-center gap-2">
                <Aperture className="size-4" />
                {ex.lensModel}
              </div>
            )}
            <div>
              {[detail?.originalFileName, mp ? `${mp} MP` : null, ex?.exifImageWidth ? `${ex.exifImageWidth} × ${ex.exifImageHeight}` : null, formatBytes(ex?.fileSizeInByte)]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          {specs.length > 0 && (
            <div className="grid border-t border-white/10 text-center text-[12px] text-white/80" style={{ gridTemplateColumns: `repeat(${specs.length}, 1fr)` }}>
              {specs.map((s, k) => (
                <div key={k} className={cn('py-2', k > 0 && 'border-l border-white/10')}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </section>

        {detail?.people && detail.people.length > 0 && (
          <section>
            <h3 className="px-1 pb-2 text-[13px] font-semibold text-white/60">People</h3>
            <div className="no-scrollbar flex gap-3 overflow-x-auto px-1">
              {detail.people.map((p) => (
                <Link key={p.id} to={`/people/${p.id}`} className="flex w-16 shrink-0 flex-col items-center gap-1">
                  <img src={personThumbUrl(p.id, p.updatedAt)} alt="" className="size-14 rounded-full bg-white/10 object-cover" />
                  <span className="w-full truncate text-center text-[11px]">{p.name || 'Unnamed'}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="flex items-start gap-3 rounded-[14px] bg-white/[0.07] px-4 py-3 text-[13px]">
          <MapPin className="mt-0.5 size-4 shrink-0 text-white/60" />
          <div className="min-w-0">
            <div className="font-semibold">{[ex?.city, ex?.state, ex?.country].filter(Boolean).join(', ') || 'No location'}</div>
            {hasGps && (
              <a
                className="text-[#0a84ff]"
                href={`https://www.openstreetmap.org/?mlat=${ex!.latitude}&mlon=${ex!.longitude}#map=15/${ex!.latitude}/${ex!.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                {ex!.latitude!.toFixed(4)}, {ex!.longitude!.toFixed(4)} · Open map
              </a>
            )}
          </div>
        </section>

        {ex?.timeZone && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-white/50">
            <Calendar className="size-3.5" /> {ex.timeZone}
          </div>
        )}
      </div>
    </aside>
  )
}
