import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { DuckSpinner } from '@/components/ui/duck-spinner'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/lib/jellyfin/auth'
import { HomeRoute } from '@/routes/HomeRoute'
import { ItemRoute } from '@/routes/ItemRoute'
import { LibraryRoute } from '@/routes/LibraryRoute'
import { LoginRoute } from '@/routes/LoginRoute'
import { SearchRoute } from '@/routes/SearchRoute'

// hls.js is ~500 kB and is only needed once you actually press play.
// Splitting it here keeps the initial load light.
const PlayerRoute = lazy(() =>
  import('@/routes/PlayerRoute').then((m) => ({ default: m.PlayerRoute })),
)

function FullscreenSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <DuckSpinner size="lg" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullscreenSpinner />
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const { status } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'signedIn' ? <Navigate to="/" replace /> : <LoginRoute />}
      />

      {/* Full-bleed: the player must not sit inside the app chrome. */}
      <Route
        path="/play/:itemId"
        element={
          <RequireAuth>
            <Suspense fallback={<FullscreenSpinner />}>
              <PlayerRoute />
            </Suspense>
          </RequireAuth>
        }
      />

      {/* Pathless layout route -- everything below shares the nav shell. */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomeRoute />} />
        <Route path="/library/:viewId" element={<LibraryRoute />} />
        <Route path="/item/:itemId" element={<ItemRoute />} />
        <Route path="/search" element={<SearchRoute />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
