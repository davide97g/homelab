import { useEffect, useState } from 'react'
import { api } from '@/lib/api.ts'
import { Button, ErrorText } from './ui.tsx'

type Providers = { google: boolean; apple: boolean }

/**
 * "Continua con Google / Apple", drawn only for the providers the server has
 * credentials for. Invite-only still holds: a Google account nobody invited
 * comes back here with `?error=…`, and that is what the message under the
 * buttons is for.
 */
export function SocialButtons({ next }: { next: string | null }) {
  const [providers, setProviders] = useState<Providers | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(() =>
    new URLSearchParams(location.search).get('error') ? 'Questo account non ha un invito, oppure l’accesso è stato annullato.' : '',
  )

  useEffect(() => {
    api<Providers>('GET', '/providers').then(setProviders, () => setProviders({ google: false, apple: false }))
  }, [])

  if (!providers || (!providers.google && !providers.apple)) return null

  async function go(provider: 'google' | 'apple') {
    setBusy(provider)
    setError('')
    try {
      const back = new URL(location.href)
      back.searchParams.delete('error')
      const r = await api<{ url?: string }>('POST', '/auth/sign-in/social', {
        provider,
        callbackURL: next ?? `${location.origin}/`,
        errorCallbackURL: back.toString(),
      })
      if (r.url) location.assign(r.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore')
      setBusy(null)
    }
  }

  return (
    <div className="mb-6 space-y-2">
      {providers.google && (
        <Button variant="ghost" className="w-full" disabled={!!busy} onClick={() => go('google')}>
          Continua con Google
        </Button>
      )}
      {providers.apple && (
        <Button variant="ghost" className="w-full" disabled={!!busy} onClick={() => go('apple')}>
          Continua con Apple
        </Button>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <p className="pt-2 text-center text-xs text-muted">oppure con un codice via email</p>
    </div>
  )
}
