import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api, personThumbUrl } from '@/lib/api/client'
import { DetailTimeline } from '@/features/timeline/DetailTimeline'
import { formatCount } from '@/lib/format'

export function AlbumRoute() {
  const { id = '' } = useParams()
  const album = useQuery({ queryKey: ['album', id], queryFn: () => api.album(id) })
  const a = album.data
  const range =
    a?.startDate && a.endDate
      ? (() => {
          const s = new Date(a.startDate)
          const e = new Date(a.endDate)
          const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          return f(s) === f(e) ? f(s) : `${f(s)} – ${f(e)}`
        })()
      : ''
  return (
    <DetailTimeline
      key={id}
      filter={{ albumId: id }}
      title={a?.albumName || (album.isLoading ? '' : 'Album')}
      subtitle={a ? [range, `${formatCount(a.assetCount)} items`].filter(Boolean).join(' · ') : undefined}
    />
  )
}

export function PersonRoute() {
  const { id = '' } = useParams()
  const person = useQuery({ queryKey: ['person', id], queryFn: () => api.person(id) })
  return (
    <DetailTimeline
      key={id}
      filter={{ personId: id }}
      title={person.data?.name || 'Unnamed'}
      avatar={<img src={personThumbUrl(id, person.data?.updatedAt)} alt="" className="mb-1 size-16 shrink-0 rounded-full bg-placeholder object-cover" />}
    />
  )
}

export const FavoritesRoute = () => <DetailTimeline filter={{ isFavorite: true }} title="Favorites" startAtEnd emptyText="Tap ♥ on a photo to add it here" />
export const RecentRoute = () => <DetailTimeline filter={{ orderBy: 'createdAt' }} title="Recently Saved" startAtEnd />
export const TrashRoute = () => (
  <DetailTimeline filter={{ isTrashed: true }} title="Recently Deleted" trashMode subtitle="Items are deleted permanently after 30 days." emptyText="No recently deleted items" />
)
export const HiddenRoute = () => <DetailTimeline filter={{ visibility: 'hidden' }} title="Hidden" emptyText="No hidden items" />
export const ArchiveRoute = () => <DetailTimeline filter={{ visibility: 'archive' }} title="Archive" emptyText="No archived items" />
