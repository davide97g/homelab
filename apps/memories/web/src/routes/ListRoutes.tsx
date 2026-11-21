import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { api, personThumbUrl } from '@/lib/api/client'
import { Page } from '@/components/Page'
import { Thumb } from '@/components/Thumb'
import { GlassButton } from '@/components/Glass'
import { ResultsGrid } from '@/features/search/ResultsGrid'
import { formatCount } from '@/lib/format'
import type { SearchFilter } from '@/lib/api/types'

export function AlbumsRoute() {
  const albums = useQuery({ queryKey: ['albums'], queryFn: () => api.albums() })
  const list = [...(albums.data ?? [])].sort((a, b) => a.albumName.localeCompare(b.albumName))
  return (
    <Page title="Albums" back>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {list.map((a) => (
          <Link key={a.id} to={`/albums/${a.id}`} className="min-w-0">
            <Thumb id={a.albumThumbnailAssetId} className="aspect-square rounded-[10px]" />
            <div className="mt-1.5 truncate text-[15px] font-medium">{a.albumName || 'Untitled'}</div>
            <div className="text-[13px] text-label-2">
              {formatCount(a.assetCount)}
              {a.shared ? ' · Shared' : ''}
            </div>
          </Link>
        ))}
      </div>
      {albums.isSuccess && !list.length && <p className="px-4 text-label-2">No albums yet.</p>}
    </Page>
  )
}

export function PeopleRoute() {
  const people = useQuery({ queryKey: ['people'], queryFn: () => api.people() })
  const list = (people.data?.people ?? []).filter((p) => !p.isHidden)
  return (
    <Page title="People & Pets" back>
      <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {list.map((p) => (
          <Link key={p.id} to={`/people/${p.id}`} className="flex min-w-0 flex-col items-center gap-1.5">
            <img src={personThumbUrl(p.id, p.updatedAt)} alt="" loading="lazy" className="aspect-square w-full rounded-full bg-placeholder object-cover" />
            <span className="w-full truncate text-center text-[13px] font-medium">{p.name || 'Add Name'}</span>
          </Link>
        ))}
      </div>
    </Page>
  )
}

export function PlacesRoute() {
  const explore = useQuery({ queryKey: ['explore'], queryFn: () => api.explore() })
  const places = explore.data?.find((e) => e.fieldName === 'exifInfo.city')?.items ?? []
  return (
    <Page title="Places" back>
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {places.map((p) => (
          <Link key={p.value} to={`/places/${encodeURIComponent(p.value)}`} className="relative aspect-square overflow-hidden rounded-[10px]">
            <Thumb id={p.data.id} thumbhash={p.data.thumbhash} className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
            <div className="absolute inset-x-2 bottom-2 truncate text-[15px] font-semibold text-white">{p.value}</div>
          </Link>
        ))}
      </div>
    </Page>
  )
}

const HEADER_H = 128

function GridPage({ title, subtitle, queryKey, fetchPage }: { title: string; subtitle?: string; queryKey: unknown[]; fetchPage: Parameters<typeof ResultsGrid>[0]['fetchPage'] }) {
  const navigate = useNavigate()
  return (
    <div className="fixed inset-0 bg-bg">
      <ResultsGrid
        queryKey={queryKey}
        fetchPage={fetchPage}
        topInset={HEADER_H}
        bottomInset={60}
        header={
          <div className="flex flex-col justify-end px-4 pb-3" style={{ height: HEADER_H }}>
            <h1 className="large-title truncate">{title}</h1>
            {subtitle && <p className="text-[13px] text-label-2">{subtitle}</p>}
          </div>
        }
      />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 px-3" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <GlassButton round aria-label="Back" className="pointer-events-auto" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </GlassButton>
      </div>
    </div>
  )
}

const metadata = (filter: SearchFilter) => (cursor: string | undefined) => api.metadataSearch({ filter, size: 250, cursor })
const smart = (query: string) => (page: string | undefined) => api.smartSearch({ query, size: 100, page: page ? Number(page) : undefined })

const MEDIA: Record<string, { title: string; subtitle?: string; fetch: (p: string | undefined) => ReturnType<typeof api.metadataSearch> }> = {
  videos: { title: 'Videos', fetch: metadata({ type: { eq: 'VIDEO' } }) },
  live: { title: 'Live Photos', fetch: metadata({ isMotion: { eq: true } }) },
  selfies: { title: 'Selfies', subtitle: 'Found by smart search', fetch: smart('selfie') },
  panoramas: { title: 'Panoramas', subtitle: 'Found by smart search', fetch: smart('panorama wide landscape') },
  screenshots: { title: 'Screenshots', subtitle: 'Found by smart search', fetch: smart('screenshot of a phone screen') },
}

export function MediaRoute() {
  const { kind = 'videos' } = useParams()
  const m = MEDIA[kind] ?? MEDIA.videos
  return <GridPage key={kind} title={m.title} subtitle={m.subtitle} queryKey={['media', kind]} fetchPage={m.fetch} />
}

export function PlaceRoute() {
  const { city = '' } = useParams()
  return <GridPage key={city} title={city} queryKey={['place', city]} fetchPage={metadata({ city: { eq: city } })} />
}
