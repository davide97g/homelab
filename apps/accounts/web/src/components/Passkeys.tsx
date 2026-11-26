import { KeyRound, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ago } from '@/lib/api.ts'
import { authClient, passkeysSupported, thisDeviceName } from '@/lib/auth-client.ts'
import { Button, Card, ErrorText } from './ui.tsx'

type Row = { id: string; name?: string | null; createdAt: string | Date; backedUp: boolean }

/** The home page's list of passkeys: add one for this device, remove old ones. */
export function Passkeys() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await authClient.passkey.listUserPasskeys()
    setRows((r.data as Row[] | null) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!passkeysSupported()) return null

  async function add() {
    setBusy(true)
    setError('')
    const r = await authClient.passkey.addPasskey({ name: thisDeviceName() })
    if (r?.error) {
      const msg = `${'code' in r.error ? r.error.code : ''} ${r.error.message ?? ''}`
      if (/EXCLUDED|already/i.test(msg)) setError('Questo dispositivo ha già una passkey per il tuo account.')
      else if (!/CANCEL|ABORT|NotAllowed/i.test(msg)) setError(r.error.message || 'Non sono riuscito ad aggiungerla.')
    }
    await load()
    setBusy(false)
  }

  async function remove(row: Row) {
    if (!confirm(`Eliminare la passkey "${row.name || 'senza nome'}"? Ricordati di toglierla anche dal portachiavi del dispositivo.`)) return
    await authClient.passkey.deletePasskey({ id: row.id })
    await load()
  }

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <KeyRound className="size-4 text-muted" /> Passkey
      </h2>
      <p className="mb-4 text-sm text-muted">Entra con Face ID, Touch ID o l’impronta, senza aspettare il codice via email.</p>
      {rows && rows.length > 0 && (
        <ul className="mb-4 flex flex-col gap-3">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{p.name || 'Passkey'}</p>
                <p className="text-xs text-muted">
                  aggiunta {ago(new Date(p.createdAt).toISOString())}
                  {p.backedUp ? ' · sincronizzata' : ''}
                </p>
              </div>
              <Button size="sm" variant="quiet" className="text-danger" onClick={() => void remove(p)}>
                Elimina
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant={rows?.length ? 'ghost' : 'primary'} size="sm" disabled={busy || !rows} onClick={() => void add()}>
        <Plus className="size-4" /> Aggiungi passkey
      </Button>
      <ErrorText>{error}</ErrorText>
    </Card>
  )
}
