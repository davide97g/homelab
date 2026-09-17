import { useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { QuackButton, type QuackButtonState } from '@/components/ui/quack-button'
import { GlowField, GlowInput } from '@/components/ui/glow-input'
import { useAuth } from '@/lib/jellyfin/auth'

export function LoginRoute() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<QuackButtonState>('idle')

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setState('loading')
    setError(null)
    try {
      await signIn(username, password)
      setState('success')
    } catch (err) {
      setState('error')
      setError(
        err instanceof Error && 'response' in err
          ? 'Incorrect username or password.'
          : 'Could not reach the server. Is Jellyfin running, and is JELLYFIN_URL correct?',
      )
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="panel flex w-full max-w-sm flex-col gap-6 rounded-3xl p-7">
        <div className="flex flex-col gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-primary-glow">
            <Clapperboard className="size-5.5" />
          </span>
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight">Cinema</h1>
            <p className="text-sm text-muted-foreground">Sign in with your Jellyfin account.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <GlowField label="Username" required>
            <GlowInput
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </GlowField>

          {/* The error hangs off the password field: it is the field you retype. */}
          <GlowField label="Password" error={error ?? undefined}>
            <GlowInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </GlowField>

          <QuackButton
            type="submit"
            className="w-full rounded-pill"
            size="lg"
            idle="breathe"
            magnetic={6}
            state={state}
            loadingLabel="Signing in"
            errorLabel="Try again"
            successLabel="Welcome back"
          >
            Sign in
          </QuackButton>
        </form>
      </div>
    </div>
  )
}
