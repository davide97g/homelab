import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, ErrorText, Shell } from '@/components/ui.tsx'
import { api } from '@/lib/api.ts'

type Code = { device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; interval: number }

/**
 * A pretend TV, for trying the device flow without one: what the Android TV
 * app does, in a browser tab. Admin page link only.
 */
export function Pair() {
  const [client, setClient] = useState<'cinema-tv' | 'memories-tv'>('cinema-tv')
  const [code, setCode] = useState<Code | null>(null)
  const [qr, setQr] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const stop = useRef(false)

  const say = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${s}`])

  async function start() {
    stop.current = false
    setError('')
    setLog([])
    const c = await api<Code>('POST', '/auth/device/code', { client_id: client })
    const app = client === 'cinema-tv' ? 'cinema' : 'memories'
    // Path per app, so the phone opens the right native app (universal links).
    const url = `${location.origin}/${app}/device?user_code=${c.user_code}`
    setCode(c)
    setQr(await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#0a0a0b', light: '#f2f2f3' } }))
    say(`codice ${c.user_code}, QR -> ${url}`)
    void poll(c, app)
  }

  async function poll(c: Code, app: string) {
    let interval = c.interval * 1000
    while (!stop.current) {
      await new Promise((r) => setTimeout(r, interval))
      const res = await fetch('/api/auth/device/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: c.device_code, client_id: client }),
      })
      const body = await res.json()
      if (body.error === 'authorization_pending') continue
      if (body.error === 'slow_down') {
        interval += 5000
        continue
      }
      if (body.error) {
        setError(body.error_description ?? body.error)
        return
      }
      say('approvato, sessione ricevuta. Chiedo il token al broker…')
      const tok = await fetch(`/api/apps/${app}/token`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.access_token}` },
        body: JSON.stringify({ deviceId: `pair-test-${client}`, deviceName: 'Test TV (browser)', client: 'Accounts pair test', version: '0.1.0' }),
      })
      const t = await tok.json()
      say(tok.ok ? `token ${app} ok: utente ${t.userId}, server ${t.serverUrl}` : `broker: ${tok.status} ${t.error}`)
      return
    }
  }

  useEffect(
    () => () => {
      stop.current = true
    },
    [],
  )

  return (
    <Shell wide>
      <h1 className="mb-1 text-2xl font-bold">Prova login TV</h1>
      <p className="mb-6 text-sm text-muted">Fa quello che farà la TV: chiede un codice, mostra il QR, aspetta.</p>
      <div className="mb-6 flex gap-2">
        <select className="h-11 rounded-full bg-surface-2 px-4 text-sm" value={client} onChange={(e) => setClient(e.target.value as typeof client)}>
          <option value="cinema-tv">cinema-tv</option>
          <option value="memories-tv">memories-tv</option>
        </select>
        <Button onClick={() => void start().catch((e) => setError(e.message))}>Nuovo codice</Button>
      </div>
      {code && (
        <Card className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <img src={qr} alt="QR" className="size-60 rounded-xl" />
          <div>
            <p className="text-sm text-muted">Vai su {code.verification_uri} e scrivi</p>
            <p className="my-2 font-mono text-4xl tracking-widest">
              {code.user_code.slice(0, 4)}-{code.user_code.slice(4)}
            </p>
          </div>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      <pre className="mt-6 text-xs whitespace-pre-wrap text-muted">{log.join('\n')}</pre>
    </Shell>
  )
}
