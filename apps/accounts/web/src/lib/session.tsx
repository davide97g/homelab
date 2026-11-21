import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type Me } from './api.ts'

type State = { status: 'loading' | 'in' | 'out'; me: Me | null; refresh: () => Promise<void>; signOut: () => Promise<void> }

const Ctx = createContext<State | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [status, setStatus] = useState<State['status']>('loading')

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('GET', '/me'))
      setStatus('in')
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e)
      setMe(null)
      setStatus('out')
    }
  }, [])

  const signOut = useCallback(async () => {
    await api('POST', '/auth/sign-out', {}).catch(() => {})
    setMe(null)
    setStatus('out')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(() => ({ status, me, refresh, signOut }), [status, me, refresh, signOut])
  return <Ctx value={value}>{children}</Ctx>
}

export function useSession() {
  const v = use(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
