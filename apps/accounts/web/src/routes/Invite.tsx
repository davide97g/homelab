import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmailCode } from '@/components/EmailCode.tsx'
import { Button, Shell } from '@/components/ui.tsx'
import { api, APP_LABEL, type AppId } from '@/lib/api.ts'
import { useSession } from '@/lib/session.tsx'

type Invite = { email: string; apps: AppId[]; state: 'open' | 'accepted' | 'expired' }

export function InvitePage() {
  const { token = '' } = useParams()
  const [inv, setInv] = useState<Invite | null>(null)
  const [error, setError] = useState('')
  const { refresh, status, me } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    api<Invite>('GET', `/invites/${token}`).then(setInv, (e) => setError(e.message))
  }, [token])

  if (error)
    return (
      <Shell>
        <h1 className="mb-2 text-2xl font-bold">Invito non valido</h1>
        <p className="text-sm text-muted">Il link è sbagliato o è stato annullato. Chiedi un nuovo invito.</p>
      </Shell>
    )
  if (!inv) return null

  const apps = inv.apps.map((a) => APP_LABEL[a] ?? a).join(' e ')

  if (inv.state !== 'open' || (status === 'in' && me?.user.email === inv.email))
    return (
      <Shell>
        <h1 className="mb-2 text-2xl font-bold">{inv.state === 'expired' ? 'Invito scaduto' : 'Invito già usato'}</h1>
        <p className="mb-6 text-sm text-muted">
          {inv.state === 'expired' ? 'Chiedi un nuovo invito.' : `Accedi con ${inv.email}.`}
        </p>
        {inv.state !== 'expired' && <Button onClick={() => navigate('/login')}>Accedi</Button>}
      </Shell>
    )

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-bold">Benvenuto</h1>
      <p className="mb-8 text-sm text-muted">
        Sei stato invitato{apps ? ` a ${apps}` : ''}. Conferma la tua email con un codice: nessuna password.
      </p>
      <EmailCode
        email={inv.email}
        onDone={async () => {
          await refresh()
          navigate('/', { replace: true })
        }}
      />
    </Shell>
  )
}
