import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, authEvents, setToken } from './api/client'
import type { UserAdminResponseDto } from './api/types'
import { requestImmichToken } from './accounts'

export const SIGNED_OUT_KEY = 'memories.signedOut'

type Status = 'checking' | 'in' | 'out'

interface AuthState {
  status: Status
  user: UserAdminResponseDto | null
  login: (email: string, password: string) => Promise<void>
  /** The normal way in: a token from the homelab's accounts service. Throws NeedsSignIn. */
  loginWithAccounts: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>('checking')
  const [user, setUser] = useState<UserAdminResponseDto | null>(null)

  useEffect(() => {
    let alive = true
    // Either the stored bearer token or the immich_access_token cookie works.
    api
      .me()
      .then((u) => {
        if (!alive) return
        setUser(u)
        setStatus('in')
      })
      .catch(() => alive && setStatus('out'))
    const onUnauthorized = () => {
      setToken(null)
      setUser(null)
      setStatus('out')
    }
    authEvents.addEventListener('unauthorized', onUnauthorized)
    return () => {
      alive = false
      authEvents.removeEventListener('unauthorized', onUnauthorized)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password)
    setToken(r.accessToken)
    const u = await api.me()
    setUser(u)
    setStatus('in')
  }, [])

  const loginWithAccounts = useCallback(async () => {
    const r = await requestImmichToken()
    setToken(r.accessToken)
    localStorage.removeItem(SIGNED_OUT_KEY)
    const u = await api.me()
    setUser(u)
    setStatus('in')
  }, [])

  const logout = useCallback(async () => {
    localStorage.setItem(SIGNED_OUT_KEY, '1')
    try {
      await api.logout()
    } catch {
      /* already gone */
    }
    setToken(null)
    setUser(null)
    qc.clear()
    setStatus('out')
  }, [qc])

  const value = useMemo(() => ({ status, user, login, loginWithAccounts, logout }), [status, user, login, loginWithAccounts, logout])
  return <Ctx value={value}>{children}</Ctx>
}

export function useAuth(): AuthState {
  const v = use(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
