import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ViewerProvider } from '@/features/viewer/ViewerProvider'
import LibraryRoute from '@/routes/LibraryRoute'
import LoginRoute from '@/routes/LoginRoute'

const CollectionsRoute = lazy(() => import('@/routes/CollectionsRoute'))
const SearchRoute = lazy(() => import('@/routes/SearchRoute'))
const UploadRoute = lazy(() => import('@/routes/UploadRoute'))
const MemoryRoute = lazy(() => import('@/routes/MemoryRoute'))
const detail = () => import('@/routes/DetailRoutes')
const lists = () => import('@/routes/ListRoutes')
const AlbumRoute = lazy(() => detail().then((m) => ({ default: m.AlbumRoute })))
const PersonRoute = lazy(() => detail().then((m) => ({ default: m.PersonRoute })))
const FavoritesRoute = lazy(() => detail().then((m) => ({ default: m.FavoritesRoute })))
const RecentRoute = lazy(() => detail().then((m) => ({ default: m.RecentRoute })))
const TrashRoute = lazy(() => detail().then((m) => ({ default: m.TrashRoute })))
const HiddenRoute = lazy(() => detail().then((m) => ({ default: m.HiddenRoute })))
const ArchiveRoute = lazy(() => detail().then((m) => ({ default: m.ArchiveRoute })))
const AlbumsRoute = lazy(() => lists().then((m) => ({ default: m.AlbumsRoute })))
const PeopleRoute = lazy(() => lists().then((m) => ({ default: m.PeopleRoute })))
const PlacesRoute = lazy(() => lists().then((m) => ({ default: m.PlacesRoute })))
const PlaceRoute = lazy(() => lists().then((m) => ({ default: m.PlaceRoute })))
const MediaRoute = lazy(() => lists().then((m) => ({ default: m.MediaRoute })))

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-bg text-label-2">
    <Loader2 className="size-7 animate-spin" />
  </div>
)

export default function App() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'checking') return <Spinner />
  if (status === 'out')
    return location.pathname === '/login' ? <LoginRoute /> : <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <ViewerProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<LibraryRoute />} />
          <Route path="/login" element={<Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />} />
          <Route path="/collections" element={<CollectionsRoute />} />
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/upload" element={<UploadRoute />} />
          <Route path="/memories/:id" element={<MemoryRoute />} />
          <Route path="/albums" element={<AlbumsRoute />} />
          <Route path="/albums/:id" element={<AlbumRoute />} />
          <Route path="/people" element={<PeopleRoute />} />
          <Route path="/people/:id" element={<PersonRoute />} />
          <Route path="/places" element={<PlacesRoute />} />
          <Route path="/places/:city" element={<PlaceRoute />} />
          <Route path="/media/:kind" element={<MediaRoute />} />
          <Route path="/favorites" element={<FavoritesRoute />} />
          <Route path="/recent" element={<RecentRoute />} />
          <Route path="/trash" element={<TrashRoute />} />
          <Route path="/hidden" element={<HiddenRoute />} />
          <Route path="/archive" element={<ArchiveRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ViewerProvider>
  )
}
