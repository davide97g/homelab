/**
 * End-to-end against a running server with DEV_OTP set:
 *   ACCOUNTS_URL=http://localhost:3190 OTP=123456 ADMIN=admin@test.local bun scripts/smoke.ts
 * Walks: admin sign-in, invite, stranger refused, invitee sign-in, the TV
 * device flow (code, claim, approve, poll), and the broker.
 */
export {}

const BASE = process.env.ACCOUNTS_URL ?? 'http://localhost:3190'
const OTP = process.env.OTP ?? '123456'
const ADMIN = process.env.ADMIN ?? 'admin@test.local'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5190'

let failures = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`)
  if (!ok) failures++
}

async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: res.status, json, token: res.headers.get('set-auth-token') }
}

async function signIn(email: string) {
  await req('POST', '/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } })
  return req('POST', '/api/auth/sign-in/email-otp', { body: { email, otp: OTP } })
}

const admin = await signIn(ADMIN)
check('admin signs in (ADMIN_EMAILS bootstrap)', admin.status === 200 && Boolean(admin.token), admin.json)
const adminToken = admin.token as string

const me = await req('GET', '/api/me', { token: adminToken })
check('admin has role admin', me.json?.user?.role === 'admin', me.json)

const stranger = await signIn(`stranger-${Date.now()}@test.local`)
check('stranger without invite is refused', stranger.status >= 400, stranger)

const guest = `guest-${Date.now()}@test.local`
const inv = await req('POST', '/api/admin/invites', { token: adminToken, body: { email: guest, apps: ['cinema'] } })
check('admin creates invite', inv.status === 200 && typeof inv.json?.url === 'string', inv.json)
const inviteToken = String(inv.json?.url ?? '').split('/invite/')[1] ?? ''

const look = await req('GET', `/api/invites/${inviteToken}`)
check('invite lookup is open', look.json?.state === 'open' && look.json?.email === guest, look.json)

const g = await signIn(guest)
check('invitee signs in with code', g.status === 200 && Boolean(g.token), g.json)
const guestToken = g.token as string

const look2 = await req('GET', `/api/invites/${inviteToken}`)
check('invite is now accepted', look2.json?.state === 'accepted', look2.json)

const notAdmin = await req('GET', '/api/admin/users', { token: guestToken })
check('guest cannot reach admin', notAdmin.status === 403, notAdmin.json)

// --- device flow, as the TV would do it --------------------------------------
const code = await req('POST', '/api/auth/device/code', { body: { client_id: 'cinema-tv' } })
check('TV gets a device code', code.status === 200 && Boolean(code.json?.user_code), code.json)
const badClient = await req('POST', '/api/auth/device/code', { body: { client_id: 'evil' } })
check('unknown client refused', badClient.status >= 400, badClient.json)

const poll = () =>
  req('POST', '/api/auth/device/token', {
    body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.json.device_code, client_id: 'cinema-tv' },
  })
const pending = await poll()
check('poll before approval is pending', pending.json?.error === 'authorization_pending', pending.json)

const claim = await req('GET', `/api/auth/device?user_code=${code.json.user_code}`, { token: guestToken })
check('phone claims the code', claim.json?.client_id === 'cinema-tv', claim.json)
const approve = await req('POST', '/api/auth/device/approve', { token: guestToken, body: { userCode: code.json.user_code } })
check('phone approves', approve.json?.success === true, approve.json)

await Bun.sleep(5500) // the polling interval
const granted = await poll()
check('TV gets a session token', typeof granted.json?.access_token === 'string', granted.json)
const tvToken = granted.json?.access_token as string

const tvMe = await req('GET', '/api/me', { token: tvToken })
check('TV session is the guest', tvMe.json?.user?.email === guest, tvMe.json)

const broker = await req('POST', '/api/apps/cinema/token', {
  token: tvToken,
  body: { deviceId: 'smoke-tv-0001', deviceName: 'Smoke TV', client: 'Cinema TV', version: '1.0.0' },
})
// Without Jellyfin configured the grant sits in `error`/`pending`: 409. With it: 200 + a token.
check(
  'broker answers (200 with Jellyfin, 409 without)',
  (broker.status === 200 && typeof broker.json?.accessToken === 'string') || broker.status === 409,
  broker,
)
const noAccess = await req('POST', '/api/apps/memories/token', {
  token: tvToken,
  body: { deviceId: 'smoke-tv-0001', deviceName: 'Smoke TV' },
})
check('broker refuses an app not granted', noAccess.status === 403, noAccess.json)

const users = await req('GET', '/api/admin/users', { token: adminToken })
const row = (users.json as any[]).find((u) => u.email === guest)
check('admin sees the invitee with cinema access row', row?.apps?.some((a: any) => a.app === 'cinema'), row)

const ban = await req('POST', `/api/admin/users/${row?.id}/ban`, { token: adminToken })
check('admin disables the invitee', ban.status === 200, ban.json)
const after = await req('GET', '/api/me', { token: tvToken })
check('TV session is gone after ban', after.status === 401, after.json)

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
