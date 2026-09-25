import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { QuackToastProvider } from '@/components/ui/quack-toast'
import { AuthProvider } from '@/lib/jellyfin/auth'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Library metadata barely changes while you browse; don't refetch on
      // every focus change and waste round trips to the server.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <QuackToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </QuackToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
