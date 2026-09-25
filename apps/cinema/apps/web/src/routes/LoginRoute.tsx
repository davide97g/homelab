import { useState } from 'react'
import { Film } from 'lucide-react'
import { useAuth } from '@/lib/jellyfin/auth'

export function LoginRoute() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signIn(username, password)
    } catch (err) {
      setError(
        err instanceof Error && 'response' in err
          ? 'Incorrect username or password.'
          : 'Could not reach the server. Is Jellyfin running, and is JELLYFIN_URL correct?',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-7 rounded-xl bg-surface p-7">
        <div className="flex flex-col gap-4">
          <Film className="size-6 text-primary" />
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Cinema</h1>
            <p className="text-sm text-muted-foreground">Sign in with your Jellyfin account.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Username">
            <input
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-11 w-full rounded-md bg-surface-2 px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-foreground/40"
            />
          </Field>

          {/* The error hangs off the password field: it is the field you retype. */}
          <Field label="Password" error={error}>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-md bg-surface-2 px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-foreground/40"
            />
          </Field>

          <button
            type="submit"
            disabled={pending}
            className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {pending && (
              <span className="size-4 animate-spin rounded-pill border-2 border-white/30 border-t-white" />
            )}
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  )
}
