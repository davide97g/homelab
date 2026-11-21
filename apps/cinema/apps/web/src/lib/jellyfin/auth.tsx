import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Api } from '@jellyfin/sdk'
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api'
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto'
import { createApi } from './client'
import { requestJellyfinToken } from '../accounts'

const STORAGE_KEY = 'cinema.session'
export const SIGNED_OUT_KEY = 'cinema.signedOut'

type StoredSession = { accessToken: string; userId: string }

type AuthContextValue = {
  /** Always present. Carries the access token once signed in. */
  api: Api
  user: UserDto | null
  userId: string | null
  status: 'loading' | 'signedOut' | 'signedIn'
  /** Local Jellyfin account (the admin's escape hatch when accounts is down). */
  signIn: (username: string, password: string) => Promise<void>
  /** The normal way in: a token from the homelab's accounts service. Throws NeedsSignIn. */
  signInWithAccounts: () => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(readStoredSession)
  const [user, setUser] = useState<UserDto | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>(
    session ? 'loading' : 'signedOut',
  )

  // One Api instance per token. Every hook reads it from context, so there is
  // exactly one source of truth for "who am I talking to and as whom".
  const api = useMemo(() => createApi(session?.accessToken), [session?.accessToken])

  // Validate a restored token on boot. A stale token must not leave the UI
  // stuck in a half-authenticated state.
  useEffect(() => {
    if (!session) {
      setUser(null)
      setStatus('signedOut')
      return
    }
    let cancelled = false
    getUserApi(api)
      .getCurrentUser()
      .then(({ data }) => {
        if (cancelled) return
        setUser(data)
        setStatus('signedIn')
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem(STORAGE_KEY)
        setSession(null)
        setUser(null)
        setStatus('signedOut')
      })
    return () => {
      cancelled = true
    }
  }, [api, session])

  const signIn = useCallback(async (username: string, password: string) => {
    // Sign in with a tokenless client, then swap in the authenticated one.
    const anonymous = createApi()
    const { data } = await getUserApi(anonymous).authenticateUserByName({
      authenticateUserByName: { Username: username, Pw: password },
    })
    if (!data.AccessToken || !data.User?.Id) {
      throw new Error('Server did not return an access token')
    }
    const next: StoredSession = { accessToken: data.AccessToken, userId: data.User.Id }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
    setUser(data.User)
    setStatus('signedIn')
  }, [])

  const signInWithAccounts = useCallback(async () => {
    const r = await requestJellyfinToken()
    const next: StoredSession = { accessToken: r.accessToken, userId: r.userId }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    localStorage.removeItem(SIGNED_OUT_KEY)
    // The boot effect validates the token and loads the user.
    setStatus('loading')
    setSession(next)
  }, [])

  const signOut = useCallback(() => {
    // Remembered so the login page does not sign straight back in through
    // the still-valid accounts cookie.
    localStorage.setItem(SIGNED_OUT_KEY, '1')
    localStorage.removeItem(STORAGE_KEY)
    setSession(null)
    setUser(null)
    setStatus('signedOut')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ api, user, userId: session?.userId ?? null, status, signIn, signInWithAccounts, signOut }),
    [api, user, session?.userId, status, signIn, signInWithAccounts, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** For hooks that are only ever mounted behind an auth gate. */
export function useSession() {
  const { api, userId } = useAuth()
  return { api, userId: userId as string }
}
