import { clsx } from 'clsx'
import { ArrowLeft, Check as CheckIcon, Link2, MoreHorizontal, Plus, RefreshCw, Send, Shield, Tv, UserPlus, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Avatar, Button, Callout, Card, CodeBlock, CopyButton, ErrorText, Input, Modal, Pill, Shell, Tabs } from '@/components/ui.tsx'
import {
  APP_META,
  type AdminUser,
  type AppRow,
  type Check,
  daysLeft,
  describe,
  type Invite,
  isConflict,
  type Upstream,
} from '@/lib/admin.ts'
import { ago, api, type AppId } from '@/lib/api.ts'
import { useSession } from '@/lib/session.tsx'

const APPS: AppId[] = ['cinema', 'memories']
type Tab = 'people' | 'setup'
type Act = (fn: () => Promise<unknown>) => () => Promise<void>
type LinkTarget = { user: AdminUser; app: AppId; preselect?: Upstream | null }

export function Admin() {
  const { status, me } = useSession()
  const [tab, setTab] = useState<Tab>('people')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState<LinkTarget | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, i] = await Promise.all([api<AdminUser[]>('GET', '/admin/users'), api<Invite[]>('GET', '/admin/invites')])
      setUsers(u)
      setInvites(i)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
    }
  }, [])
  const loadChecks = useCallback(async () => {
    setChecks(null)
    setChecks(await api<Check[]>('GET', '/admin/setup').catch(() => []))
  }, [])

  useEffect(() => {
    if (me?.user.role === 'admin') {
      void load()
      void loadChecks()
    }
  }, [me, load, loadChecks])

  /** Runs an action, shows its error at the top, reloads. */
  const act: Act = (fn) => async () => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
    }
    await load()
  }

  const problems = useMemo(() => (checks ?? []).filter((c) => c.status !== 'ok'), [checks])
  const mailOff = checks?.some((c) => c.id === 'mail' && c.status !== 'ok') ?? false

  if (status === 'loading') return null
  if (status === 'out') return <Navigate to="/login?next=/admin" replace />
  if (me?.user.role !== 'admin') return <Navigate to="/" replace />

  const pending = invites.filter((i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date())
  const stuck = (users ?? []).flatMap((u) => u.apps.filter((a) => a.status !== 'active').map((a) => ({ u, a })))
  const errors = problems.filter((c) => c.status === 'error').length

  return (
    <Shell wide>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted hover:text-fg" aria-label="Indietro">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-muted">Chi entra, in quali app, e lo stato del servizio.</p>
          </div>
        </div>
        <Link to="/pair">
          <Button variant="ghost" size="sm">
            <Tv className="size-3.5" /> Prova login TV
          </Button>
        </Link>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'people', label: 'Persone', badge: { n: stuck.length, tone: 'warn' } },
          { id: 'setup', label: 'Setup', badge: { n: problems.length, tone: errors ? 'danger' : 'warn' } },
        ]}
      />

      {error && (
        <Callout tone="danger" title="L'ultima azione non è andata" className="mb-4">
          {error}
        </Callout>
      )}

      {tab === 'people' ? (
        <div className="flex flex-col gap-6">
          {(stuck.length > 0 || problems.length > 0) && (
            <ToDo stuck={stuck} problems={problems} onLink={setLinking} onSetup={() => setTab('setup')} act={act} />
          )}
          <InviteForm onDone={load} mailOff={mailOff} />
          {pending.length > 0 && <Pending invites={pending} act={act} />}
          <section>
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Persone{users ? ` · ${users.length}` : ''}</h2>
            <div className="flex flex-col gap-4">
              {[...(users ?? [])].sort((a, b) => Number(b.id === me.user.id) - Number(a.id === me.user.id)).map((u) => <UserCard key={u.id} u={u} self={u.id === me.user.id} act={act} onLink={setLinking} />)}
            </div>
          </section>
        </div>
      ) : (
        <Setup checks={checks} onRefresh={loadChecks} />
      )}

      <LinkModal target={linking} onClose={() => setLinking(null)} onDone={load} />
    </Shell>
  )
}

/** What needs a hand right now, each with the button that fixes it. */
function ToDo({
  stuck,
  problems,
  onLink,
  onSetup,
  act,
}: {
  stuck: { u: AdminUser; a: AppRow }[]
  problems: Check[]
  onLink: (t: LinkTarget) => void
  onSetup: () => void
  act: Act
}) {
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Wrench className="size-4 text-warn" /> Da sistemare
      </h2>
      <div className="flex flex-col gap-2">
        {stuck.map(({ u, a }) => {
          const meta = APP_META[a.app]
          if (a.suggest)
            return (
              <Callout
                key={`${u.id}-${a.app}`}
                tone="warn"
                title={`${meta.label} di ${u.name}: c'è già un account ${meta.upstream} da collegare`}
                actions={
                  <>
                    <Button size="sm" onClick={() => onLink({ user: u, app: a.app, preselect: a.suggest })}>
                      <Link2 className="size-3.5" /> Collega {a.suggest.login}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => onLink({ user: u, app: a.app })}>
                      Scegli un altro account
                    </Button>
                  </>
                }
              >
                {meta.upstream} ha già l'utente <b className="text-fg">{a.suggest.login}</b>
                {a.suggest.admin ? ' (admin)' : ''}. Collegandolo, {meta.label} usa quell'account con tutto quello che contiene. La sua
                password viene sostituita.
              </Callout>
            )
          if (isConflict(a))
            return (
              <Callout
                key={`${u.id}-${a.app}`}
                tone="warn"
                title={`${meta.label} di ${u.name}: c'è già un account ${meta.upstream} con la sua email`}
                actions={
                  <Button size="sm" onClick={() => onLink({ user: u, app: a.app })}>
                    <Link2 className="size-3.5" /> Scegli l'account da collegare
                  </Button>
                }
              >
                Non ne creo un altro: va collegato quello che c'è, così {meta.label} usa i contenuti che ha già. La sua password viene
                sostituita.
              </Callout>
            )
          return (
            <Callout
              key={`${u.id}-${a.app}`}
              tone={a.status === 'error' ? 'danger' : 'warn'}
              title={`${meta.label} di ${u.name}: ${a.status === 'error' ? 'non attivata' : 'in preparazione'}`}
              actions={
                <>
                  <Button size="sm" onClick={act(() => api('POST', `/admin/users/${u.id}/apps/${a.app}`))}>
                    <RefreshCw className="size-3.5" /> Riprova
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => onLink({ user: u, app: a.app })}>
                    <Link2 className="size-3.5" /> Collega un account esistente
                  </Button>
                </>
              }
            >
              {a.lastError ?? 'Account non ancora creato.'}
            </Callout>
          )
        })}
        {problems.length > 0 && (
          <Callout
            tone={problems.some((p) => p.status === 'error') ? 'danger' : 'warn'}
            title={`${problems.length} ${problems.length === 1 ? 'cosa' : 'cose'} nel setup`}
            actions={
              <Button size="sm" variant="ghost" onClick={onSetup}>
                Apri Setup
              </Button>
            }
          >
            {problems.map((p) => p.title).join(' · ')}
          </Callout>
        )}
      </div>
    </Card>
  )
}

function InviteForm({ onDone, mailOff }: { onDone: () => Promise<void>; mailOff: boolean }) {
  const [email, setEmail] = useState('')
  const [apps, setApps] = useState<AppId[]>(['cinema', 'memories'])
  const [admin, setAdmin] = useState(false)
  const [sent, setSent] = useState<{ email: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ url: string }>('POST', '/admin/invites', { email, apps, role: admin ? 'admin' : 'user' })
      setSent({ email, url: r.url })
      setEmail('')
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore'
      setError(/già un account/i.test(msg) ? `${email} ha già un account: dagli le app dalla sua scheda qui sotto.` : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-semibold">
        <UserPlus className="size-4 text-muted" /> Invita qualcuno
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Riceve un link, conferma l'email con un codice e trova le app pronte. Nessuna password da inventare.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input type="email" required placeholder="nome@esempio.it" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid gap-2 sm:grid-cols-2">
          {APPS.map((a) => {
            const meta = APP_META[a]
            const on = apps.includes(a)
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => setApps((cur) => (on ? cur.filter((x) => x !== a) : [...cur, a]))}
                className={clsx(
                  'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  on ? 'border-fg/60 bg-surface-2' : 'border-line hover:border-muted',
                )}
              >
                <meta.icon className={clsx('size-5', on ? 'text-fg' : 'text-muted')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{meta.label}</span>
                  <span className="block truncate text-xs text-muted">{meta.what}</span>
                </span>
                <span className={clsx('grid size-5 place-items-center rounded-full border', on ? 'border-fg bg-fg text-canvas' : 'border-line')}>
                  {on && <CheckIcon className="size-3" />}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} className="size-4 accent-white" />
            Anche admin (può invitare e gestire le app)
          </label>
          <Button disabled={busy || !email}>
            <Send className="size-4" /> {mailOff ? 'Crea invito' : 'Manda invito'}
          </Button>
        </div>
        {mailOff && <p className="text-xs text-muted">Le email non sono configurate: l'invito non parte da solo, ti do il link da mandare tu.</p>}
      </form>
      <ErrorText>{error}</ErrorText>
      {sent && (
        <Callout tone="ok" title={mailOff ? `Invito pronto per ${sent.email}` : `Invito mandato a ${sent.email}`} className="mt-4">
          {mailOff ? 'Mandagli questo link:' : 'Se non lo trova, mandagli questo link:'}
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs text-fg">{sent.url}</code>
            <CopyButton text={sent.url} label="Copia" />
          </div>
        </Callout>
      )}
    </Card>
  )
}

function Pending({ invites, act }: { invites: Invite[]; act: Act }) {
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Inviti in attesa</h2>
      <ul className="flex flex-col divide-y divide-line">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate">{i.email}</p>
              <p className="text-xs text-muted">
                {i.apps.map((a) => APP_META[a].label).join(' + ') || 'nessuna app'} · scade tra {daysLeft(i.expiresAt)} g
                {i.role === 'admin' ? ' · admin' : ''}
              </p>
            </div>
            <Button size="sm" variant="quiet" onClick={act(() => api('DELETE', `/admin/invites/${i.id}`))}>
              Annulla
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function UserCard({ u, self, act, onLink }: { u: AdminUser; self: boolean; act: Act; onLink: (t: LinkTarget) => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <Card className={u.banned ? 'opacity-60' : ''}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={u.name || u.email} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold">
              {u.name}
              {self && <Pill>tu</Pill>}
              {u.role === 'admin' && (
                <Pill>
                  <Shield className="size-3" /> admin
                </Pill>
              )}
              {u.banned && <Pill tone="danger">disattivato</Pill>}
            </p>
            <p className="truncate text-sm text-muted">{u.email}</p>
          </div>
        </div>
        {!self && (
          <div className="relative">
            <Button size="sm" variant="quiet" onClick={() => setMenu((m) => !m)} aria-label="Altro">
              <MoreHorizontal className="size-4" />
            </Button>
            {menu && (
              <div className="absolute top-9 right-0 z-10 flex w-48 flex-col rounded-xl border border-line bg-surface-2 p-1 text-sm shadow-xl">
                <button
                  className="rounded-lg px-3 py-2 text-left hover:bg-line"
                  onClick={() => {
                    setMenu(false)
                    void act(() => api('POST', `/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }))()
                  }}
                >
                  {u.role === 'admin' ? 'Togli admin' : 'Rendi admin'}
                </button>
                <button
                  className="rounded-lg px-3 py-2 text-left text-danger hover:bg-line"
                  onClick={() => {
                    setMenu(false)
                    if (u.banned || confirm(`Disattivare ${u.email}? Esce da ogni dispositivo e non può più accedere.`))
                      void act(() => api('POST', `/admin/users/${u.id}/${u.banned ? 'unban' : 'ban'}`))()
                  }}
                >
                  {u.banned ? 'Riattiva' : 'Disattiva account'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {APPS.map((app) => (
          <AppLine key={app} u={u} app={app} row={u.apps.find((x) => x.app === app)} act={act} onLink={onLink} />
        ))}
      </div>

      {u.devices.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Dispositivi</p>
          <ul className="flex flex-col gap-1.5">
            {u.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {d.deviceName} <span className="text-muted">· {APP_META[d.app].label} · {ago(d.lastSeenAt)}</span>
                </span>
                <Button size="sm" variant="quiet" className="text-danger" onClick={act(() => api('DELETE', `/admin/devices/${d.id}`))}>
                  Scollega
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/** One app for one person: where it stands and what can be done about it. */
function AppLine({ u, app, row, act, onLink }: { u: AdminUser; app: AppId; row: AppRow | undefined; act: Act; onLink: (t: LinkTarget) => void }) {
  const meta = APP_META[app]
  const state = describe(row)
  const devices = u.devices.filter((d) => d.app === app).length

  let detail: string
  if (!row) detail = `Nessun account ${meta.upstream}.`
  else if (row.status === 'active')
    detail = `Account ${meta.upstream} ${row.upstreamLogin ?? ''}${devices ? ` · ${devices} ${devices === 1 ? 'dispositivo' : 'dispositivi'}` : ''}`
  else if (row.suggest) detail = `Esiste già ${row.suggest.login} su ${meta.upstream}: va collegato.`
  else if (row.status === 'error')
    detail = isConflict(row) ? `C'è già un account ${meta.upstream} con questa email: va collegato.` : (row.lastError ?? 'Errore')
  else detail = 'Creazione in corso.'

  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <meta.icon className="size-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {meta.label} <Pill tone={state.tone}>{state.label}</Pill>
        </p>
        <p className="truncate text-xs text-muted" title={row?.lastError ?? undefined}>
          {detail}
        </p>
      </div>
      <div className="flex w-full flex-wrap gap-1.5 pl-8 sm:w-auto sm:pl-0">
        {!row && (
          <>
            <Button size="sm" variant="ghost" onClick={act(() => api('POST', `/admin/users/${u.id}/apps/${app}`))}>
              <Plus className="size-3.5" /> Crea account
            </Button>
            <Button size="sm" variant="quiet" onClick={() => onLink({ user: u, app })}>
              <Link2 className="size-3.5" /> Collega esistente
            </Button>
          </>
        )}
        {row && row.status !== 'active' && (
          <>
            <Button size="sm" variant={row.suggest || isConflict(row) ? 'primary' : 'ghost'} onClick={() => onLink({ user: u, app, preselect: row.suggest })}>
              <Link2 className="size-3.5" /> Collega
            </Button>
            {!row.suggest && !isConflict(row) && (
              <Button size="sm" variant="quiet" onClick={act(() => api('POST', `/admin/users/${u.id}/apps/${app}`))}>
                Riprova
              </Button>
            )}
          </>
        )}
        {row && (
          <Button
            size="sm"
            variant="quiet"
            onClick={act(async () => {
              const msg =
                row.status === 'active'
                  ? `Togliere ${meta.label} a ${u.email}?\n\nTutti i suoi dispositivi ${meta.label} escono e l'account ${meta.upstream} viene bloccato (i contenuti restano).`
                  : `Annullare ${meta.label} per ${u.email}? Non tocca ${meta.upstream}.`
              if (confirm(msg)) await api('DELETE', `/admin/users/${u.id}/apps/${app}`)
            })}
          >
            {row.status === 'active' ? 'Togli' : 'Annulla'}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Pick an upstream account, understand what linking does, confirm. */
function LinkModal({ target, onClose, onDone }: { target: LinkTarget | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [candidates, setCandidates] = useState<Upstream[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!target) return
    setCandidates(null)
    setError('')
    setUnderstood(false)
    setPicked(target.preselect?.id ?? null)
    api<Upstream[]>('GET', `/admin/upstream/${target.app}/users`)
      .then((list) => {
        setCandidates(list)
        if (!target.preselect) {
          const email = target.user.email.toLowerCase()
          const guess = list.find((c) => c.login.toLowerCase() === email || c.login.toLowerCase() === email.split('@')[0])
          if (guess) setPicked(guess.id)
        }
      })
      .catch((e) => {
        setCandidates([])
        setError(e instanceof Error ? e.message : 'Errore')
      })
  }, [target])

  if (!target)
    return (
      <Modal open={false} onClose={onClose} title="">
        {null}
      </Modal>
    )
  const meta = APP_META[target.app]
  const choice = candidates?.find((c) => c.id === picked)
  const email = target.user.email.toLowerCase()

  async function link() {
    if (!target || !choice) return
    setBusy(true)
    setError('')
    try {
      await api('POST', `/admin/users/${target.user.id}/apps/${target.app}`, { linkTo: choice.id })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Collega ${meta.label} a ${target.user.name}`}>
      <p className="mb-4 text-sm text-muted">
        Scegli l'account {meta.upstream} che è già di {target.user.name}. Da quel momento {meta.label}, le TV e le app entrano con quell'account,
        con tutto quello che contiene.
      </p>

      {candidates === null ? (
        <p className="py-6 text-center text-sm text-muted">Carico gli account {meta.upstream}…</p>
      ) : error && candidates.length === 0 ? (
        <Callout tone="danger" title={`Non riesco a leggere gli account ${meta.upstream}`}>
          {error}
        </Callout>
      ) : candidates.length === 0 ? (
        <Callout tone="muted" title={`Nessun account ${meta.upstream} libero`}>
          Sono tutti già collegati a qualcuno. Usa "Crea account" per farne uno nuovo.
        </Callout>
      ) : (
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {candidates.map((c) => {
            const match = c.login.toLowerCase() === email || c.login.toLowerCase() === email.split('@')[0]
            return (
              <label
                key={c.id}
                className={clsx(
                  'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm',
                  picked === c.id ? 'border-fg/60 bg-surface-2' : 'border-line hover:border-muted',
                )}
              >
                <input type="radio" name="upstream" checked={picked === c.id} onChange={() => setPicked(c.id)} className="accent-white" />
                <span className="min-w-0 flex-1 truncate">{c.login}</span>
                {match && <Pill tone="ok">stessa email</Pill>}
                {c.admin && <Pill tone="warn">admin</Pill>}
              </label>
            )
          })}
        </div>
      )}

      {choice && (
        <div className="mt-4 flex flex-col gap-2">
          <Callout tone="warn" title="La password di questo account viene sostituita">
            accounts ne mette una casuale che conosce solo lui. Il vecchio login di <b className="text-fg">{choice.login}</b> su {meta.upstream}{' '}
            smette di funzionare: si entra con il codice via email.
          </Callout>
          {choice.admin && (
            <Callout tone="danger" title={`${choice.login} è admin di ${meta.upstream}`}>
              Se accounts si ferma, nessuno entra come admin, a meno che esista un altro admin locale con una password sua. Il tab Setup ti dice se
              c'è.
              <label className="mt-3 flex items-center gap-2 text-fg">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="size-4 accent-white" />
                Ho un altro admin locale (o lo creo subito)
              </label>
            </Callout>
          )}
        </div>
      )}

      {candidates && candidates.length > 0 && <ErrorText>{error}</ErrorText>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>
          Annulla
        </Button>
        <Button disabled={!choice || busy || (choice.admin && !understood)} onClick={() => void link()}>
          <Link2 className="size-4" /> {busy ? 'Collego…' : 'Collega'}
        </Button>
      </div>
    </Modal>
  )
}

/** Every moving part, grouped, with the fix under anything that is not green. */
function Setup({ checks, onRefresh }: { checks: Check[] | null; onRefresh: () => Promise<void> }) {
  if (!checks) return <p className="py-12 text-center text-sm text-muted">Controllo email, Jellyfin, Immich e link…</p>
  const groups = [...new Set(checks.map((c) => c.group))]
  const bad = checks.filter((c) => c.status !== 'ok')
  return (
    <div className="flex flex-col gap-4">
      <Callout
        tone={bad.some((c) => c.status === 'error') ? 'danger' : bad.length ? 'warn' : 'ok'}
        title={bad.length ? `${bad.length} da sistemare su ${checks.length} controlli` : 'Tutto a posto'}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void onRefresh()}>
            <RefreshCw className="size-3.5" /> Ricontrolla
          </Button>
        }
      >
        Controlli fatti adesso dal server: configurazione, chiavi, raggiungibilità. Sotto ogni problema c'è come risolverlo.
      </Callout>
      {groups.map((g) => (
        <Card key={g}>
          <h2 className="mb-3 font-semibold">{g}</h2>
          <ul className="flex flex-col divide-y divide-line">
            {checks
              .filter((c) => c.group === g)
              .map((c) => (
                <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span
                      className={clsx('mt-1.5 size-2.5 shrink-0 rounded-full', c.status === 'ok' ? 'bg-ok' : c.status === 'warn' ? 'bg-warn' : 'bg-danger')}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{c.title}</p>
                      <p className="text-sm break-words text-muted">{c.detail}</p>
                      {c.fix && c.status !== 'ok' && <CodeBlock>{c.fix}</CodeBlock>}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
