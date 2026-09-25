import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/kavita/auth'
import { HttpError } from '@/lib/kavita/client'
import { Bubble, Button, Spinner, Wordmark } from '@/components/ui'

export function LoginRoute() {
  const { user, signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(username.trim(), password)
    } catch (err) {
      setError(
        err instanceof HttpError && err.status === 401
          ? 'That username and password don’t match. Try again.'
          : 'The library server isn’t answering. Check that it’s running.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
      <div aria-hidden className="tone pointer-events-none absolute -right-24 -top-24 size-[28rem] rounded-full opacity-80" />
      <div aria-hidden className="tone pointer-events-none absolute -bottom-32 -left-28 size-[22rem] rounded-full opacity-60" />

      <div className="relative w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <Wordmark size="lg" />
          <Bubble tailX="42px" className="mt-8 px-5 py-3 text-[1.05rem] italic">
            Every chapter you've saved, on one shelf.
          </Bubble>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-[28px] bg-sheet p-6 shadow-card">
          <Field label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus />
          <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          {error && (
            <p role="alert" className="text-[0.9rem] text-ink">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !username || !password} className="w-full">
            {busy && <Spinner />}
            Start reading
          </Button>
        </form>
      </div>
    </main>
  )
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.85rem] text-ink-2">{label}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border-2 border-rule bg-paper px-4 py-3 text-[1rem] text-ink outline-none transition focus:border-ink"
      />
    </label>
  )
}
