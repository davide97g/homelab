import { CheckCircle2, Tv, XCircle } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmailCode } from '@/components/EmailCode.tsx'
import { Button, Callout, ErrorText, Input, Shell } from '@/components/ui.tsx'
import { api, APP_LABEL, CLIENT_LABEL, type AppId } from '@/lib/api.ts'
import { useSession } from '@/lib/session.tsx'

const CLIENT_APP: Record<string, AppId> = { 'cinema-tv': 'cinema', 'memories-tv': 'memories' }

const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const pretty = (s: string) => {
  const n = normalize(s)
  return n.length > 4 ? `${n.slice(0, 4)}-${n.slice(4, 8)}` : n
}

type Claim = { user_code: string; status: 'pending' | 'approved' | 'denied'; client_id?: string }

/**
 * Where a TV's QR lands (/cinema/device?user_code=…) when the phone has no app,
 * and where anyone can type the code by hand. Sign in, check, approve.
 */
export function DevicePage() {
  const [params] = useSearchParams()
  const { status, me, refresh } = useSession()
  const [code, setCode] = useState(pretty(params.get('user_code') ?? params.get('code') ?? ''))
  const [claim, setClaim] = useState<Claim | null>(null)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function check(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      setClaim(await api<Claim>('GET', `/auth/device?user_code=${normalize(code)}`))
    } catch (err) {
      setError(err instanceof Error && /expired/i.test(err.message) ? 'Codice scaduto: generane uno nuovo sulla TV.' : 'Codice non valido.')
    } finally {
      setBusy(false)
    }
  }

  // Arrived from a QR, already signed in: check straight away.
  useEffect(() => {
    if (status === 'in' && normalize(code).length === 8 && !claim && !error) void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function decide(approve: boolean) {
    setBusy(true)
    setError('')
    try {
      await api('POST', approve ? '/auth/device/approve' : '/auth/device/deny', { userCode: normalize(code) })
      setDone(approve ? 'approved' : 'denied')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return null

  if (status === 'out')
    return (
      <Shell>
        <Tv className="mb-4 size-8 text-muted" />
        <h1 className="mb-1 text-2xl font-bold">Collega un dispositivo</h1>
        <p className="mb-8 text-sm text-muted">Prima accedi, poi autorizzi {code ? <b className="text-fg">{code}</b> : 'il codice'}.</p>
        <EmailCode onDone={refresh} />
      </Shell>
    )

  if (done)
    return (
      <Shell>
        {done === 'approved' ? <CheckCircle2 className="mb-4 size-10 text-ok" /> : <XCircle className="mb-4 size-10 text-danger" />}
        <h1 className="mb-1 text-2xl font-bold">{done === 'approved' ? 'Fatto' : 'Rifiutato'}</h1>
        <p className="text-sm text-muted">
          {done === 'approved' ? 'Il dispositivo entra da solo tra qualche secondo.' : 'Il dispositivo non è stato collegato.'}
        </p>
      </Shell>
    )

  if (claim) {
    const app = claim.client_id ? CLIENT_APP[claim.client_id] : undefined
    const label = (claim.client_id && CLIENT_LABEL[claim.client_id]) ?? 'Un dispositivo'
    const allowed = !app || me?.apps.some((a) => a.app === app && a.status === 'active')
    if (claim.status !== 'pending')
      return (
        <Shell>
          <h1 className="mb-1 text-2xl font-bold">Codice già usato</h1>
          <p className="text-sm text-muted">Generane uno nuovo sulla TV.</p>
        </Shell>
      )
    return (
      <Shell>
        <Tv className="mb-4 size-8 text-muted" />
        <h1 className="mb-1 text-2xl font-bold">{label}</h1>
        <p className="mb-2 text-sm text-muted">
          vuole accedere come <span className="text-fg">{me?.user.email}</span>.
        </p>
        <p className="mb-8 font-mono text-lg tracking-widest">{pretty(code)}</p>
        {!allowed && app && (
          <Callout tone="warn" title={`${APP_LABEL[app]} non è ancora attiva per te`} className="mb-4">
            Se autorizzi, la TV non riesce comunque a entrare.{' '}
            {me?.user.role === 'admin' ? (
              <>
                Completa l'attivazione da{' '}
                <a href="/admin" className="text-fg underline">
                  Admin
                </a>{' '}
                (sezione "Da sistemare"), poi sulla TV premi Riprova.
              </>
            ) : (
              'Chiedi a un admin di attivarla, poi sulla TV premi Riprova.'
            )}
          </Callout>
        )}
        <div className="flex flex-col gap-3">
          <Button disabled={busy} onClick={() => void decide(true)}>
            Autorizza
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
            Non sono stato io
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <Tv className="mb-4 size-8 text-muted" />
      <h1 className="mb-1 text-2xl font-bold">Collega un dispositivo</h1>
      <p className="mb-8 text-sm text-muted">Scrivi il codice che vedi sulla TV.</p>
      <form onSubmit={check} className="flex flex-col gap-3">
        <Input
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABCD-EFGH"
          className="text-center font-mono text-2xl tracking-widest uppercase"
          value={code}
          onChange={(e) => setCode(pretty(e.target.value))}
          autoFocus
        />
        <Button disabled={busy || normalize(code).length !== 8}>Continua</Button>
        <ErrorText>{error}</ErrorText>
      </form>
    </Shell>
  )
}
