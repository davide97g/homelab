import { eq } from 'drizzle-orm'
import { DEVICE_CLIENTS } from '../auth.ts'
import { db } from '../db/client.ts'
import { type AppId, appAccess, user as userTable } from '../db/schema.ts'
import { env, isProd } from '../env.ts'
import * as immich from '../upstream/immich.ts'
import * as jellyfin from '../upstream/jellyfin.ts'
import * as seerr from '../upstream/seerr.ts'
import { isStale, readPipeline } from './pipeline.ts'

/**
 * What the admin page's Setup tab shows: every moving part this service needs,
 * checked live, each with what is wrong and the exact fix. Nothing here returns
 * a secret, only whether it is set and whether it works.
 */
export type Check = {
  id: string
  group: 'Email' | 'Cinema' | 'Memories' | 'App e TV' | 'Admin'
  status: 'ok' | 'warn' | 'error'
  title: string
  detail: string
  /** Steps or a command, shown under the check when it is not ok. */
  fix?: string
}

const ENV_FILE = '/volume1/docker/accounts/.env'
const RESTART = `ssh nas 'cd /volume1/docker/accounts && docker compose up -d'`

async function reachable(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return r.ok ? null : `HTTP ${r.status}`
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

async function upstreamChecks(app: AppId): Promise<Check[]> {
  const group = app === 'cinema' ? 'Cinema' : 'Memories'
  const name = app === 'cinema' ? 'Jellyfin' : 'Immich'
  const enabled = app === 'cinema' ? jellyfin.jellyfinEnabled() : immich.immichEnabled()
  const keyVar = app === 'cinema' ? 'JELLYFIN_URL e JELLYFIN_API_KEY' : 'IMMICH_URL e IMMICH_API_KEY'
  const keyHow =
    app === 'cinema'
      ? 'Jellyfin → Dashboard → Chiavi API → + (nome "accounts").'
      : "Immich, da un utente admin → Impostazioni account → Chiavi API → nuova chiave con tutti i permessi."
  const out: Check[] = []

  if (!enabled) {
    out.push({
      id: `${app}-key`,
      group,
      status: 'error',
      title: `${name} non configurato`,
      detail: `Senza ${keyVar} nessuno può avere ${group}: non si creano account e la TV non entra.`,
      fix: `${keyHow}\nScrivi ${keyVar} in ${ENV_FILE}, poi:\n${RESTART}`,
    })
    return out
  }

  // The admin key: list users. Also tells us who is an upstream admin.
  type Up = { id: string; login: string; admin: boolean }
  let users: Up[] | null = null
  try {
    users =
      app === 'cinema'
        ? (await jellyfin.listUsers()).map((u) => ({ id: u.Id, login: u.Name, admin: Boolean(u.Policy?.IsAdministrator) }))
        : (await immich.listUsers()).filter((u) => !u.deletedAt).map((u) => ({ id: u.id, login: u.email, admin: u.isAdmin }))
    out.push({
      id: `${app}-key`,
      group,
      status: 'ok',
      title: `${name} raggiungibile, chiave admin valida`,
      detail: `${users.length} utenti ${name}.`,
    })
  } catch (e) {
    out.push({
      id: `${app}-key`,
      group,
      status: 'error',
      title: `${name} non risponde alla chiave admin`,
      detail: e instanceof Error ? e.message : String(e),
      fix: `Controlla che ${name} sia acceso e che la chiave in ${ENV_FILE} esista ancora (${keyHow}). Poi:\n${RESTART}`,
    })
  }

  // The URL handed to apps must answer from outside.
  const publicUrl = app === 'cinema' ? env.JELLYFIN_PUBLIC_URL : env.IMMICH_PUBLIC_URL
  const probe = app === 'cinema' ? `${publicUrl.replace(/\/+$/, '')}/System/Info/Public` : `${publicUrl.replace(/\/+$/, '')}/api/server/ping`
  const err = await reachable(probe)
  out.push(
    err
      ? {
          id: `${app}-public`,
          group,
          status: 'error',
          title: `L'indirizzo pubblico di ${name} non risponde`,
          detail: `${publicUrl}: ${err}. È l'indirizzo che app e TV ricevono dopo l'accesso.`,
          fix: `Controlla il proxy e il tunnel Cloudflare per ${new URL(publicUrl).host}.`,
        }
      : { id: `${app}-public`, group, status: 'ok', title: 'Indirizzo pubblico raggiungibile', detail: publicUrl },
  )

  // A local admin nobody here owns: the way in when accounts is down.
  if (users) {
    const owned = new Set(
      (await db.select({ id: appAccess.upstreamUserId }).from(appAccess).where(eq(appAccess.app, app))).map((r) => r.id),
    )
    const localAdmins = users.filter((u) => u.admin && !owned.has(u.id))
    out.push(
      localAdmins.length
        ? {
            id: `${app}-local-admin`,
            group,
            status: 'ok',
            title: 'Admin locale di riserva',
            detail: `${localAdmins.map((u) => u.login).join(', ')}: entra con la sua password anche se accounts è giù.`,
          }
        : {
            id: `${app}-local-admin`,
            group,
            status: 'warn',
            title: 'Nessun admin locale di riserva',
            detail: `Ogni admin di ${name} è collegato qui (password sostituita). Se accounts si ferma, nessuno entra in ${name} come admin.`,
            fix: `Crea in ${name} un secondo utente admin con una password tua e non collegarlo.`,
          },
    )
  }
  return out
}

/** Discover in cinema: Seerr through its API key (admin user 1 answers /auth/me). */
async function seerrCheck(): Promise<Check> {
  const fix = `Seerr → Impostazioni → Generali → Chiave API. In ${ENV_FILE}:\nSEERR_URL=https://discover.davideghiotto.it\nSEERR_API_KEY=…\npoi:\n${RESTART}`
  if (!seerr.seerrEnabled())
    return {
      id: 'seerr',
      group: 'Cinema',
      status: 'warn',
      title: 'Discover non configurato',
      detail: 'Senza SEERR_URL e SEERR_API_KEY la sezione Discover di cinema non carica e non si possono chiedere titoli.',
      fix,
    }
  try {
    const me = await seerr.asUser(1, '/auth/me')
    if (me.status !== 200) throw new Error(`HTTP ${me.status}`)
    return { id: 'seerr', group: 'Cinema', status: 'ok', title: 'Discover: Seerr raggiungibile', detail: env.SEERR_URL ?? '' }
  } catch (e) {
    return {
      id: 'seerr',
      group: 'Cinema',
      status: 'error',
      title: 'Seerr non risponde alla chiave API',
      detail: e instanceof Error ? e.message : String(e),
      fix,
    }
  }
}

/** The mini PC's progress report, behind Discover's progress bars and the library refresh. */
async function pipelineCheck(): Promise<Check> {
  const fix = `Sul mini PC: scp -r hosts/debian/nas-sync homelab:/tmp/ && ssh homelab 'bash /tmp/nas-sync/install.sh'\nControlla: ssh homelab 'systemctl --user status nas-pipeline; journalctl --user -u nas-pipeline -n 20'`
  const doc = await readPipeline()
  if (!doc)
    return {
      id: 'pipeline',
      group: 'Cinema',
      status: 'warn',
      title: 'Avanzamento download non disponibile',
      detail: `Manca ${env.PIPELINE_STATUS_FILE}: Discover mostra solo lo stato di Seerr, senza tempi, e Jellyfin aspetta la sua scansione.`,
      fix,
    }
  if (isStale(doc))
    return { id: 'pipeline', group: 'Cinema', status: 'warn', title: 'Avanzamento download fermo', detail: `Ultimo aggiornamento ${doc.at}`, fix }
  return { id: 'pipeline', group: 'Cinema', status: 'ok', title: 'Avanzamento download aggiornato', detail: doc.sync.note }
}

export async function setupChecks(): Promise<Check[]> {
  const checks: Check[] = []

  // Email.
  if (env.RESEND_API_KEY) {
    checks.push({
      id: 'mail',
      group: 'Email',
      status: 'ok',
      title: 'Email attive (Resend)',
      detail: `Codici e inviti partono da ${env.MAIL_FROM}.`,
    })
  } else {
    checks.push({
      id: 'mail',
      group: 'Email',
      status: 'warn',
      title: 'Email non configurate',
      detail:
        'Codici di accesso e inviti non partono: finiscono nel log del server. Gli inviti si possono mandare a mano (il link compare dopo "Invita").',
      fix: `1. resend.com → Domains: verifica ${env.MAIL_FROM.match(/@([^>]+)/)?.[1] ?? 'il dominio'} (record SPF/DKIM su Cloudflare).\n2. API Keys → crea una chiave "Sending access".\n3. Scrivi RESEND_API_KEY=… in ${ENV_FILE}, poi:\n${RESTART}\n\nNel frattempo, per leggere un codice:\nssh nas "docker logs --since 15m accounts 2>&1 | grep '\\[mail\\]'"`,
    })
  }
  if (isProd && process.env.DEV_OTP) {
    checks.push({
      id: 'dev-otp',
      group: 'Email',
      status: 'warn',
      title: 'DEV_OTP è impostato in produzione',
      detail: 'Viene ignorato (i codici restano casuali), ma non dovrebbe esserci.',
      fix: `Togli DEV_OTP da ${ENV_FILE}, poi:\n${RESTART}`,
    })
  }

  // Upstreams, in parallel.
  const [cinema, memories] = await Promise.all([upstreamChecks('cinema'), upstreamChecks('memories')])
  checks.push(...cinema, ...memories, await seerrCheck(), await pipelineCheck())

  // Universal links: the QR on a TV opens the phone app only with these.
  const apple = (env.APPLE_APP_LINKS ?? '').split(';').map((p) => p.trim()).filter(Boolean)
  const missing = (['cinema', 'memories'] as const).filter((a) => !apple.some((p) => p.includes(`/${a}/`)))
  checks.push(
    missing.length
      ? {
          id: 'apple-links',
          group: 'App e TV',
          status: 'warn',
          title: `Link universali iOS mancanti: ${missing.join(', ')}`,
          detail: 'Il QR della TV apre la pagina web invece dell\'app sull\'iPhone. Funziona lo stesso, con un passaggio in più.',
          fix: `In ${ENV_FILE}:\nAPPLE_APP_LINKS=DA596D32QB.it.davideghiotto.cinema=/cinema/*;DA596D32QB.it.davideghiotto.memories=/memories/*\npoi:\n${RESTART}`,
        }
      : {
          id: 'apple-links',
          group: 'App e TV',
          status: 'ok',
          title: 'Link universali iOS',
          detail: 'Il QR della TV apre Cinema o Memories sull\'iPhone.',
        },
  )
  checks.push({
    id: 'device-clients',
    group: 'App e TV',
    status: 'ok',
    title: 'TV che possono chiedere un codice',
    detail: Object.entries(DEVICE_CLIENTS)
      .map(([client, app]) => `${client} → ${app}`)
      .join(' · '),
  })

  // Admins.
  const admins = await db.select({ email: userTable.email }).from(userTable).where(eq(userTable.role, 'admin'))
  checks.push(
    admins.length
      ? { id: 'admins', group: 'Admin', status: 'ok', title: `${admins.length} admin`, detail: admins.map((a) => a.email).join(', ') }
      : {
          id: 'admins',
          group: 'Admin',
          status: 'error',
          title: 'Nessun admin',
          detail: 'Nessuno può invitare o dare app.',
          fix: `Metti la tua email in ADMIN_EMAILS in ${ENV_FILE}, riavvia e accedi: diventi admin al primo accesso.`,
        },
  )
  return checks
}

/**
 * For an app row in error: the upstream account it most likely is (same email
 * in Immich, same email name in Jellyfin), so the page can offer "link this one".
 */
export async function suggestLinks(rows: { userId: string; email: string; app: AppId }[]) {
  const out = new Map<string, { id: string; login: string; admin: boolean }>()
  if (!rows.length) return out
  const apps = new Set(rows.map((r) => r.app))
  const owned = new Set((await db.select({ id: appAccess.upstreamUserId }).from(appAccess)).map((r) => r.id))
  const [jf, im] = await Promise.all([
    apps.has('cinema') && jellyfin.jellyfinEnabled() ? jellyfin.listUsers().catch(() => []) : [],
    apps.has('memories') && immich.immichEnabled() ? immich.listUsers().catch(() => []) : [],
  ])
  for (const r of rows) {
    const email = r.email.toLowerCase()
    if (r.app === 'memories') {
      const m = im.find((u) => !u.deletedAt && u.email.toLowerCase() === email && !owned.has(u.id))
      if (m) out.set(`${r.userId}:${r.app}`, { id: m.id, login: m.email, admin: m.isAdmin })
    } else {
      const stem = email.split('@')[0]
      const m = jf.find((u) => u.Name.toLowerCase() === stem && !owned.has(u.Id))
      if (m) out.set(`${r.userId}:${r.app}`, { id: m.Id, login: m.Name, admin: Boolean(m.Policy?.IsAdministrator) })
    }
  }
  return out
}
