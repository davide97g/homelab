import { ArrowUpRight, LogOut, Shield, Tv } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { Avatar, Button, Card, Pill, Shell } from '@/components/ui.tsx'
import { APP_META } from '@/lib/admin.ts'
import { ago, api, type AppId } from '@/lib/api.ts'
import { useSession } from '@/lib/session.tsx'

const APP_URL: Record<AppId, string> = {
  cinema: 'https://cinema.davideghiotto.it',
  memories: 'https://memories.davideghiotto.it',
}
const ALL: AppId[] = ['cinema', 'memories']

export function Home() {
  const { status, me, refresh, signOut } = useSession()
  if (status === 'loading') return null
  if (status === 'out' || !me) return <Navigate to="/login" replace />
  const isAdmin = me.user.role === 'admin'

  return (
    <Shell wide>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={me.user.name || me.user.email} className="size-12 text-base" />
          <div>
            <h1 className="text-2xl font-bold">Ciao {me.user.name.split(' ')[0]}</h1>
            <p className="text-sm text-muted">{me.user.email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Link to="/admin">
              <Button variant="ghost">
                <Shield className="size-4" /> Admin
              </Button>
            </Link>
          )}
          <Button variant="quiet" onClick={() => void signOut()}>
            <LogOut className="size-4" /> Esci
          </Button>
        </div>
      </header>

      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Le tue app</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        {ALL.map((app) => {
          const meta = APP_META[app]
          const row = me.apps.find((a) => a.app === app)
          const active = row?.status === 'active'
          const body = (
            <Card className={active ? 'h-full transition-colors hover:bg-surface-2' : 'h-full opacity-80'}>
              <div className="mb-3 flex items-start justify-between">
                <meta.icon className="size-7" />
                {active ? (
                  <ArrowUpRight className="size-5 text-muted" />
                ) : row ? (
                  <Pill tone="warn">in preparazione</Pill>
                ) : (
                  <Pill>non attiva</Pill>
                )}
              </div>
              <p className="font-semibold">{meta.label}</p>
              <p className="text-sm text-muted">{meta.what}</p>
              {!active && (
                <p className="mt-3 text-xs text-muted">
                  {row
                    ? isAdmin
                      ? 'Va completata: apri Admin, la trovi in "Da sistemare".'
                      : "Un admin deve completare l'attivazione."
                    : isAdmin
                      ? 'Dattela da Admin, sulla tua scheda.'
                      : 'Chiedila a un admin.'}
                </p>
              )}
            </Card>
          )
          return active ? (
            <a key={app} href={APP_URL[app]}>
              {body}
            </a>
          ) : (
            <div key={app}>{body}</div>
          )
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <Tv className="size-4 text-muted" /> Collega una TV
          </h2>
          <ol className="mb-4 flex list-inside list-decimal flex-col gap-1 text-sm text-muted">
            <li>Apri Cinema o Memories sulla TV: mostra un codice e un QR.</li>
            <li>Inquadra il QR con l'iPhone (si apre l'app), oppure scrivi il codice qui.</li>
            <li>Autorizza: la TV entra da sola.</li>
          </ol>
          <Link to="/device">
            <Button variant="ghost" size="sm">
              Ho un codice
            </Button>
          </Link>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Dispositivi collegati</h2>
          {me.devices.length === 0 && <p className="text-sm text-muted">Nessuno ancora. TV e app compaiono qui quando entrano.</p>}
          <ul className="flex flex-col gap-3">
            {me.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{d.deviceName}</p>
                  <p className="text-xs text-muted">
                    {APP_META[d.app].label} · ultimo accesso {ago(d.lastSeenAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="quiet"
                  className="text-danger"
                  onClick={async () => {
                    if (!confirm(`Scollegare ${d.deviceName}? Dovrà rifare l'accesso.`)) return
                    await api('DELETE', `/me/devices/${d.id}`)
                    await refresh()
                  }}
                >
                  Scollega
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  )
}
