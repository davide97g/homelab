import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { SIGNED_OUT_KEY, useAuth } from '@/lib/auth'
import { goToSignIn, NeedsSignIn } from '@/lib/accounts'

export default function LoginRoute() {
  const { login, loginWithAccounts } = useAuth()
  const [local, setLocal] = useState(false)
  const [ssoBusy, setSsoBusy] = useState(false)
  const tried = useRef(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useQuery({ queryKey: ['server-version'], queryFn: api.serverVersion, retry: false })

  /** interactive: off to the accounts sign-in page when there is no session there. */
  async function sso(interactive: boolean) {
    setSsoBusy(true)
    setError(null)
    try {
      await loginWithAccounts()
    } catch (err) {
      if (err instanceof NeedsSignIn) {
        if (interactive) goToSignIn()
      } else setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSsoBusy(false)
    }
  }

  // Signed in to accounts already (another app, or back from its login page):
  // straight in. Not right after an explicit sign-out.
  useEffect(() => {
    if (tried.current || localStorage.getItem(SIGNED_OUT_KEY)) return
    tried.current = true
    void sso(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 overflow-y-auto bg-grouped">
      {/* soft photo-ish backdrop, drawn locally */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-50"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 15%, #ffb36b55, transparent 70%), radial-gradient(50% 45% at 85% 25%, #4677ee55, transparent 70%), radial-gradient(60% 50% at 50% 100%, #ff6f9144, transparent 70%)',
        }}
      />
      <div className="relative mx-auto flex min-h-full max-w-[400px] flex-col justify-center px-6 py-16">
        <img src="/icon.svg" alt="" className="mx-auto size-20 rounded-[22px] shadow-xl" />
        <h1 className="large-title mt-5 text-center">Memories</h1>
        <p className="mt-1 text-center text-[15px] text-label-2">Sign in to your library</p>
        <div className="mt-8 space-y-3">
          <button
            type="button"
            disabled={ssoBusy}
            onClick={() => void sso(true)}
            className="flex h-12 w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            {ssoBusy ? <Loader2 className="size-5 animate-spin" /> : 'Sign In'}
          </button>
          {!local && error && <p className="px-1 text-[13px] text-destructive">{error}</p>}
          {!local && (
            <button type="button" onClick={() => setLocal(true)} className="w-full text-center text-[13px] text-label-2">
              Local Immich account
            </button>
          )}
        </div>
        {local && <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await login(email.trim(), password)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Sign in failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="glass overflow-hidden rounded-[14px]">
            <input
              type="email"
              autoComplete="username"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full bg-transparent px-4 text-[17px] outline-none placeholder:text-label-2"
            />
            <div className="ml-4 border-t border-separator" />
            <input
              type="password"
              autoComplete="current-password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full bg-transparent px-4 text-[17px] outline-none placeholder:text-label-2"
            />
          </div>
          {error && <p className="px-1 text-[13px] text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex h-12 w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : 'Sign In Locally'}
          </button>
        </form>}
        <p className="mt-8 text-center text-[12px] text-label-3">
          {version.data ? `Server v${version.data.major}.${version.data.minor}.${version.data.patch}` : version.isError ? 'Server unreachable' : ' '}
        </p>
      </div>
    </div>
  )
}
