import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api.ts'
import { Button, ErrorText, Input } from './ui.tsx'

/**
 * Email, then a 6-digit code. No passwords anywhere. With `email` fixed (the
 * invite page) it starts at "send the code".
 */
export function EmailCode({ email: fixed, onDone }: { email?: string; onDone: () => void | Promise<void> }) {
  const [email, setEmail] = useState(fixed ?? '')
  const [sent, setSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('POST', '/auth/email-otp/send-verification-otp', { email: email.trim(), type: 'sign-in' })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('POST', '/auth/sign-in/email-otp', { email: email.trim(), otp: otp.trim() })
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore'
      setError(/invite|invito|FORBIDDEN/i.test(msg) ? 'Questa email non ha un invito.' : /otp|code/i.test(msg) ? 'Codice non valido o scaduto.' : msg)
    } finally {
      setBusy(false)
    }
  }

  if (!sent)
    return (
      <form onSubmit={send} className="flex flex-col gap-3">
        {fixed ? (
          <p className="rounded-xl bg-surface px-4 py-3 text-sm">{fixed}</p>
        ) : (
          <Input type="email" autoComplete="email" placeholder="La tua email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        )}
        <Button disabled={busy || !email}>Mandami il codice</Button>
        <ErrorText>{error}</ErrorText>
      </form>
    )

  return (
    <form onSubmit={verify} className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Se <span className="text-fg">{email}</span> ha un account, è arrivato un codice di 6 cifre.
      </p>
      <Input
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="000000"
        className="text-center text-2xl tracking-[0.5em]"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        autoFocus
      />
      <Button disabled={busy || otp.length !== 6}>Entra</Button>
      <button type="button" className="text-sm text-muted hover:text-fg" onClick={() => void send()} disabled={busy}>
        Rimanda il codice
      </button>
      <ErrorText>{error}</ErrorText>
    </form>
  )
}
