import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Archive,
  ChevronRight,
  Clock,
  CircleUserRound,
  EyeOff,
  Heart,
  Images,
  LogOut,
  MapPin,
  Monitor,
  GalleryHorizontal,
  Trash2,
  Upload,
  Video,
  Aperture,
  type LucideIcon,
} from 'lucide-react'
import { api, personThumbUrl } from '@/lib/api/client'
import { Page, SectionHeader } from '@/components/Page'
import { Thumb } from '@/components/Thumb'
import { GlassButton } from '@/components/Glass'
import { TabBar, TAB_BAR_SPACE } from '@/components/TabBar'
import { useAuth } from '@/lib/auth'
import { formatCount, todayIso } from '@/lib/format'
import type { AssetResponseDto } from '@/lib/api/types'

const hscroll = 'no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4'

function useKeyAsset(key: string, filter: Parameters<typeof api.metadataSearch>[0]['filter']) {
  return useQuery({
    queryKey: ['key-asset', key],
    queryFn: async () => (await api.metadataSearch({ filter, size: 1 })).assets.items[0] ?? null,
    staleTime: 5 * 60_000,
  })
}

function PinnedTile({ to, label, icon: Icon, asset }: { to: string; label: string; icon: LucideIcon; asset?: AssetResponseDto | null }) {
  return (
    <Link to={to} className="w-[38%] shrink-0 snap-start sm:w-[180px]">
      <div className="relative aspect-square overflow-hidden rounded-[10px] bg-placeholder">
        {asset && <Thumb id={asset.id} thumbhash={asset.thumbhash} className="absolute inset-0" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
        <Icon className="absolute bottom-2 left-2 size-5 text-white drop-shadow" strokeWidth={2.2} />
      </div>
      <div className="mt-1.5 truncate text-[15px] font-medium">{label}</div>
    </Link>
  )
}

function Row({ to, icon: Icon, label, detail, last }: { to: string; icon: LucideIcon; label: string; detail?: string; last?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-3 pl-4 transition-colors active:bg-fill">
      <Icon className="size-[22px] text-accent" strokeWidth={2} />
      <div className={`flex flex-1 items-center justify-between py-3 pr-3 ${last ? '' : 'border-b border-separator'}`}>
        <span className="text-[17px]">{label}</span>
        <span className="flex items-center gap-1 text-label-2">
          {detail && <span className="text-[15px]">{detail}</span>}
          <ChevronRight className="size-4" strokeWidth={2.5} />
        </span>
      </div>
    </Link>
  )
}

export default function CollectionsRoute() {
  const { logout, user } = useAuth()
  const albums = useQuery({ queryKey: ['albums'], queryFn: () => api.albums() })
  const people = useQuery({ queryKey: ['people'], queryFn: () => api.people() })
  const memories = useQuery({ queryKey: ['memories', todayIso()], queryFn: () => api.memories(todayIso()) })
  const explore = useQuery({ queryKey: ['explore'], queryFn: () => api.explore() })
  const fav = useKeyAsset('fav', { isFavorite: { eq: true } })
  const recent = useKeyAsset('recent', undefined)
  const video = useKeyAsset('video', { type: { eq: 'VIDEO' } })

  const places = explore.data?.find((e) => e.fieldName === 'exifInfo.city')?.items ?? []
  const namedPeople = (people.data?.people ?? []).filter((p) => !p.isHidden && p.name)
  const albumList = [...(albums.data ?? [])].sort((a, b) => (b.endDate ?? b.updatedAt).localeCompare(a.endDate ?? a.updatedAt))

  return (
    <>
      <Page
        title="Collections"
        grouped
        bottomSpace={TAB_BAR_SPACE + 40}
        right={
          <GlassButton round aria-label={`Account${user ? `: ${user.name}` : ''}`} title="Sign out" onClick={() => logout()}>
            <LogOut className="size-5" />
          </GlassButton>
        }
      >
        <SectionHeader title="Pinned" className="pt-1" />
        <div className={hscroll}>
          <PinnedTile to="/favorites" label="Favorites" icon={Heart} asset={fav.data} />
          <PinnedTile to="/recent" label="Recently Saved" icon={Clock} asset={recent.data} />
          <PinnedTile to="/places" label="Map" icon={MapPin} asset={places[0]?.data} />
          <PinnedTile to="/media/videos" label="Videos" icon={Video} asset={video.data} />
        </div>

        <SectionHeader title="Albums" to="/albums" />
        {albums.isLoading ? (
          <div className="mx-4 h-40 animate-pulse rounded-[10px] bg-fill" />
        ) : albumList.length ? (
          <div className={`${hscroll} grid grid-flow-col grid-rows-2 auto-cols-[42%] sm:auto-cols-[180px]`}>
            {albumList.map((a) => (
              <Link key={a.id} to={`/albums/${a.id}`} className="min-w-0 snap-start">
                <Thumb id={a.albumThumbnailAssetId} className="aspect-square rounded-[10px]" />
                <div className="mt-1.5 truncate text-[15px] font-medium">{a.albumName || 'Untitled'}</div>
                <div className="text-[13px] text-label-2">{formatCount(a.assetCount)}</div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-4 text-label-2">No albums yet.</p>
        )}

        {namedPeople.length > 0 && (
          <>
            <SectionHeader title="People & Pets" to="/people" />
            <div className={`${hscroll} gap-4`}>
              {namedPeople.slice(0, 24).map((p) => (
                <Link key={p.id} to={`/people/${p.id}`} className="flex w-[84px] shrink-0 snap-start flex-col items-center gap-1.5">
                  <img src={personThumbUrl(p.id, p.updatedAt)} alt="" loading="lazy" className="size-[84px] rounded-full bg-placeholder object-cover" />
                  <span className="w-full truncate text-center text-[13px] font-medium">{p.name}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {(memories.data?.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Memories" />
            <div className={hscroll}>
              {memories.data!.map((m) => {
                const cover = m.assets[0]
                const yearsAgo = new Date().getFullYear() - m.data.year
                return (
                  <Link key={m.id} to={`/memories/${m.id}`} className="relative aspect-[3/4] w-[62%] shrink-0 snap-start overflow-hidden rounded-[16px] sm:w-[240px]">
                    <Thumb id={cover?.id} thumbhash={cover?.thumbhash} size="preview" className="absolute inset-0" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <div className="absolute inset-x-3 bottom-3 text-white">
                      <div className="font-display text-[22px] leading-tight font-bold">{m.type === 'birthday' ? `${m.data.personName ?? ''}'s Birthday` : 'On This Day'}</div>
                      <div className="text-[13px] font-medium opacity-85">
                        {m.data.year} · {yearsAgo} year{yearsAgo === 1 ? '' : 's'} ago
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}

        {places.length > 0 && (
          <>
            <SectionHeader title="Places" to="/places" />
            <div className={hscroll}>
              {places.slice(0, 20).map((p) => (
                <Link key={p.value} to={`/places/${encodeURIComponent(p.value)}`} className="relative aspect-square w-[42%] shrink-0 snap-start overflow-hidden rounded-[10px] sm:w-[180px]">
                  <Thumb id={p.data.id} thumbhash={p.data.thumbhash} className="absolute inset-0" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                  <div className="absolute inset-x-2 bottom-2 truncate text-[15px] font-semibold text-white">{p.value}</div>
                </Link>
              ))}
            </div>
          </>
        )}

        <SectionHeader title="Media Types" />
        <div className="mx-4 overflow-hidden rounded-[12px] bg-card">
          <Row to="/media/videos" icon={Video} label="Videos" />
          <Row to="/media/live" icon={Aperture} label="Live Photos" />
          <Row to="/media/selfies" icon={CircleUserRound} label="Selfies" />
          <Row to="/media/panoramas" icon={GalleryHorizontal} label="Panoramas" />
          <Row to="/media/screenshots" icon={Monitor} label="Screenshots" last />
        </div>

        <SectionHeader title="Utilities" />
        <div className="mx-4 overflow-hidden rounded-[12px] bg-card">
          <Row to="/upload" icon={Upload} label="Imports" />
          <Row to="/hidden" icon={EyeOff} label="Hidden" />
          <Row to="/archive" icon={Archive} label="Archive" />
          <Row to="/trash" icon={Trash2} label="Recently Deleted" last />
        </div>
        <p className="flex items-center justify-center gap-1.5 pt-6 text-[12px] text-label-3">
          <Images className="size-3.5" /> Memories
        </p>
      </Page>
      <TabBar />
    </>
  )
}
