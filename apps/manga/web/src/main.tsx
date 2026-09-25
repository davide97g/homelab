import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/lib/kavita/auth'
import { HttpError } from '@/lib/kavita/client'
import { LoginRoute } from '@/routes/LoginRoute'
import { HomeRoute } from '@/routes/HomeRoute'
import { SeriesRoute } from '@/routes/SeriesRoute'
import { ReaderRoute } from '@/routes/ReaderRoute'
import { SearchRoute } from '@/routes/SearchRoute'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof HttpError && e.status < 500) && n < 2,
    },
  },
})

function Protected() {
  const { user } = useAuth()
  return user ? <Outlet /> : <Navigate to="/login" replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route element={<Protected />}>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/series/:id" element={<SeriesRoute />} />
              <Route path="/read/:chapterId" element={<ReaderRoute />} />
              <Route path="/search" element={<SearchRoute />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
