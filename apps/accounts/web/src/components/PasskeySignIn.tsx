import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { authClient, conditionalUiAvailable, passkeysSupported } from '@/lib/auth-client.ts'
import { Button, ErrorText } from './ui.tsx'

/**
 * "Entra con una passkey": Face ID, Touch ID, Windows Hello or a key. The
 * passkey is discoverable, so no email is asked first. Where the browser
 * supports it, saved passkeys also show up in the email field's autofill
 * (the field carries `autocomplete="email webauthn"`).
 */
export function PasskeySignIn({ onDone }: { onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Autofill: a pending ceremony the browser completes when someone picks a
  // passkey from the email field's suggestions. Pressing the button aborts it
  // and starts a modal one (simplewebauthn does that on its own).
  useEffect(() => {
    let live = true
    void conditionalUiAvailable().then(async (ok) => {
      if (!ok || !live) return
      const r = await authClient.signIn.passkey({ autoFill: true })
      if (live && r?.data && !r.error) await onDone()
    })
    return () => {
      live = false
    }
  }, [onDone])

  if (!passkeysSupported()) return null

  async function go() {
    setBusy(true)
    setError('')
    const r = await authClient.signIn.passkey()
    if (r?.error) {
      const cancelled = /CANCEL|ABORT|NotAllowed/i.test(`${'code' in r.error ? r.error.code : ''} ${r.error.message ?? ''}`)
      setError(cancelled ? '' : 'Passkey non riconosciuta. Entra con il codice e aggiungila dalla home.')
      setBusy(false)
      return
    }
    await onDone()
  }

  return (
    <div className="mb-6 space-y-2">
      <Button className="w-full" disabled={busy} onClick={() => void go()}>
        <KeyRound className="size-4" /> Entra con una passkey
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}
