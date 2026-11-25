# accounts

Single sign-on for the homelab: **one account per person, a 6-digit code by email or Google or
Apple, no passwords**.
Admins invite people and choose which apps they get. TVs sign in with a code or a QR that a phone
approves.

Live at **`https://accounts.davideghiotto.it`** since 2026-11-12, on the NAS next to Jellyfin and Immich.

| | |
|---|---|
| Stack | Bun + Hono + Better Auth 1.7 (`emailOTP`, `admin`, `bearer`, `deviceAuthorization`) + Drizzle + Postgres 17; React 19 + Vite + Tailwind v4 web |
| Host | UGREEN NAS, `/volume1/docker/accounts` (not `~`: a UGOS update wipes the home dir) |
| Port | `127.0.0.1:2290` → container `:3000`, only cloudflared calls it |
| Tunnel | `nas-ilario`, ingress `accounts.davideghiotto.it` → `http://localhost:2290` |
| Mail | Resend, from `accounts@davideghiotto.it` |

## How it works

```
 browser / TV / iPhone ──► accounts ──(admin API key)──► Jellyfin / Immich
        ▲                     │
        └── Jellyfin / Immich token (the broker) ◄──┘
```

- **The broker.** Every user has a Jellyfin and/or Immich account with a random password that only
  this service knows, encrypted with `BROKER_KEY`. `POST /api/apps/:app/token` signs in upstream as
  that user, from the caller's device identity, and returns the app's own token.
- **Downtime is cheap.** Clients keep the Jellyfin/Immich token and talk to the upstream directly.
  If accounts is down, devices that are already signed in keep working. Only new sign-ins, invites
  and revocations stop.
- **Shared cookie.** In production the session cookie is set on `.davideghiotto.it`. A browser
  signed in here is signed in to cinema and memories with no further click.
- **Revocation goes all the way.** Unlinking a device deletes its Better Auth session plus its
  Jellyfin device (`DELETE /Devices`) or its Immich session (`/auth/logout` with its own token).
  Disabling a user does the same for every device of theirs. Removing an app disables the Jellyfin
  user, or rotates the Immich password.
- **No open sign-up.** A user row is only created for an email with a live invite, or one listed in
  `ADMIN_EMAILS` (the bootstrap). A code is only mailed to known, invited or admin emails.

## Google and Apple

Optional, each on its own: the buttons appear (here and in cassette) only for a provider whose
variables are set, and `GET /api/providers` says which. **Invite-only still holds**: the user-create
hook refuses an email with no invite whichever door it came through, and a Google or Apple account
whose verified email matches an existing user is linked to it (`accountLinking.trustedProviders`).

- **Google**: Google Cloud console → APIs & Services → Credentials → OAuth client ID → *Web
  application*. Authorized redirect URI `https://accounts.davideghiotto.it/api/auth/callback/google`.
  Scopes are only `openid email profile`, so the consent screen can be published to *In production*
  without verification — leave it in *Testing* and only listed test users can sign in.
- **Apple**: developer.apple.com → Identifiers → a *Services ID* (that is `APPLE_CLIENT_ID`) with
  Sign in with Apple on, domain `accounts.davideghiotto.it`, return URL
  `https://accounts.davideghiotto.it/api/auth/callback/apple`; Keys → a key with Sign in with Apple
  (`APPLE_KEY_ID`, the `.p8` into `APPLE_PRIVATE_KEY` with newlines as `\n`); `APPLE_TEAM_ID` is the
  team. The client secret is a JWT signed from that key at boot (`lib/apple.ts`), valid six months:
  every deploy restarts the clock, and a container left up longer stops Apple sign-ins until restarted.

## Admin page

`/admin` has two tabs:

- **Persone**: "Da sistemare" at the top lists every app that is not active, with the button that fixes
  it. An app that failed because an account with the same email already exists upstream is offered
  as "Collega <that account>": the server guesses it (same email in Immich, email name in Jellyfin),
  the dialog explains that its password gets replaced and asks for confirmation when it is an
  upstream admin. Below: invite (app cards, admin toggle; with mail off it hands you the link), pending
  invites, and one card per person with one line per app (state, upstream login, devices, actions).
- **Setup**: `GET /api/admin/setup` checks live, from the server: mail (Resend), each upstream's admin
  key and public URL, whether a local upstream admin is left for when accounts is down, iOS universal
  links, the TV clients, admins. Anything not green shows its fix, copyable.

## API for clients

All paths are under `/api`. Native clients send `Authorization: Bearer <session token>`.

| What | Call |
|---|---|
| Send code | `POST /auth/email-otp/send-verification-otp` `{email, type:"sign-in"}` |
| Sign in | `POST /auth/sign-in/email-otp` `{email, otp}` → session token in the `set-auth-token` header |
| Who am I | `GET /me` → `{user, apps, devices}` |
| App token | `POST /apps/{cinema\|memories}/token` `{deviceId, deviceName, client, version}` → `{accessToken, userId, serverUrl}` |
| **TV:** start | `POST /auth/device/code` `{client_id:"cinema-tv"}` → `{device_code, user_code, interval, …}` |
| **TV:** poll | `POST /auth/device/token` `{grant_type:"urn:ietf:params:oauth:grant-type:device_code", device_code, client_id}`. Errors are `authorization_pending`, `slow_down`, `access_denied` and `expired_token`. On success it returns `{access_token}`, which is a session token. |
| **Phone:** claim | `GET /auth/device?user_code=XXXXXXXX`. This is required before approve, because it binds the code to the caller. |
| **Phone:** approve / deny | `POST /auth/device/approve` or `/deny` `{userCode}` |
| **Phone app, no email code:** check / approve / deny | `POST /device/with-app` `{app, userCode, action:"check"\|"approve"\|"deny"}` with `Authorization: Bearer <the app's own Immich or Jellyfin token>`. accounts asks the upstream whose token it is, finds the homelab account linked to that upstream user (409 `not_linked` otherwise), and approves only TVs of the same app. No session is handed out. |

The QR on the TV encodes `https://accounts.davideghiotto.it/{cinema|memories}/device?user_code=…`.
There is one path per app so each iOS/Android app claims its own universal link: with the app
installed the phone opens it, without the app the same URL is the web approval page.
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` are generated from
`APPLE_APP_LINKS` / `ANDROID_APP_LINKS`.

Allowed device clients: `cinema-tv`, `memories-tv` (`DEVICE_CLIENTS` in `server/src/auth.ts`).

### Discover (cinema → Seerr)

`/api/discover/*` is cinema's Discover section. Every cinema client calls it with the Jellyfin
token it already holds (`Authorization: Bearer <jellyfin token>`), so nobody signs in to Seerr.
accounts asks Jellyfin whose token it is, finds the Seerr user with that `jellyfinUserId`
(importing them from Jellyfin with Seerr's default permissions the first time), and calls Seerr
with `SEERR_API_KEY` plus `X-API-User: <their id>`. Seerr's own permissions, quotas and
auto-approve rules therefore apply unchanged; accounts only decides who is asking.

| What | Call |
|---|---|
| Who Seerr thinks you are | `GET /discover/me` → `{id, displayName, canRequest:{movie,tv}, autoApprove:{movie,tv}}` |
| Rows | `GET /discover/discover/{trending\|movies\|tv\|movies/upcoming\|tv/upcoming}?page=1` |
| Search | `GET /discover/search?query=…&page=1` |
| Details | `GET /discover/{movie\|tv}/{tmdbId}` (+ `/recommendations`, `/similar`, `/season/{n}`) |
| Your requests | `GET /discover/request?take=20` (always pinned to you: `requestedBy` is overwritten) |
| Request | `POST /discover/request` `{mediaType, mediaId, seasons?}`; quality, folder and profile are Seerr's defaults (HD ITA) |
| Withdraw | `DELETE /discover/request/{id}` (Seerr allows it only for your own pending request) |
| Progress | `GET /discover/progress?keys=movie:603,tv:1396` → per title: stage, download and NAS-copy bytes, ETAs |

**Progress and the library refresh.** The mini PC's `nas-pipeline.service`
(`hosts/debian/nas-sync/nas-pipeline.py`) reads the Radarr/Sonarr download queues and nas-sync's
state and pushes one JSON every 10-60 s to `/volume1/docker/accounts/pipeline/status.json`, mounted
here read-only at `/pipeline` (`PIPELINE_STATUS_FILE`). `/discover/progress` serves it per title.
The same file lists what arrived on the NAS in the last hour: every 15 s accounts tells Jellyfin
(`POST /Library/Media/Updated`, paths under `JELLYFIN_MEDIA_ROOT=/data`) and then runs Seerr's
`jellyfin-recently-added-scan` 45 s and 3 min later, so a new film turns "available" with its Watch
button within minutes. The Setup tab warns when the file is missing or older than 3 minutes.

Any other path is a 404. Responses lose emails, tokens and internal URLs on the way out.
Token → Jellyfin user and Jellyfin user → Seerr user are cached for 5 minutes, so a permission
changed in Seerr shows up within that.

## Develop

```sh
docker run -d --name accounts-pg-dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=accounts -p 55432:5432 postgres:17-alpine
cd apps/accounts && bun install
cp server/.env.example server/.env   # set BROKER_KEY=$(openssl rand -base64 32)
cd server && bun --env-file=.env src/db/migrate.ts && bun --env-file=.env --watch src/server.ts
cd ../web && bunx vite                 # http://localhost:5190, DEV_OTP=123456 signs anyone in
bun --cwd server scripts/smoke.ts      # 20 checks: invite, refusal, device flow, broker, ban
```

`/pair` (linked from the admin page) is a pretend TV. It requests a code, shows the QR, polls, and
calls the broker, so the whole flow can be tested without the Android app.

Schema change: edit `server/src/db/schema.ts`, then `bun run db:generate`. The container runs the
migrations on start.

## Deploy (NAS)

First time:

1. Create the env file: `ssh nas 'mkdir -p /volume1/docker/accounts'`, then write `.env` there from
   `.env.example`. Generate every secret fresh. Back up `BROKER_KEY` outside the NAS: without it
   every upstream account has to be re-linked.
2. Create the upstream keys. In Jellyfin, go to *Dashboard → API Keys → +* (name `accounts`). In
   Immich, use an admin's *Account settings → API keys* with all permissions.
3. In Resend, verify `davideghiotto.it` (SPF/DKIM) if it is not verified already.
4. Send the files over and start:
   ```sh
   cd apps/accounts
   tar czf - --exclude node_modules --exclude dist --exclude .env . | ssh nas 'tar xzf - -C /volume1/docker/accounts'
   ssh nas 'cd /volume1/docker/accounts && docker compose up -d --build'
   ssh nas 'curl -s http://127.0.0.1:2290/api/health'   # {"ok":true}
   ```
5. Add the tunnel ingress: put `accounts.davideghiotto.it` → `http://localhost:2290` on `nas-ilario`,
   the same way as cinema (`apps/cinema/docs/DEPLOY.md`). Then add a proxied CNAME.
6. Sign in with an `ADMIN_EMAILS` address. On your own card, link the existing Jellyfin/Immich
   accounts (🔗). Then invite everyone else, or create and link them.

**Keep one local admin per app.** Linking resets the upstream password, so that account's own
password stops working. Keep a separate local Jellyfin admin and Immich admin for the day accounts
is down. Cinema and memories still show a small "local account" sign-in.

After that, an update is a push to `main`: the mini PC's NAS deploy loop
([`hosts/debian/nas-deploy`](../../hosts/debian/nas-deploy/)) ships `apps/accounts` and runs step 4's
`docker compose up -d --build` within 5 minutes.

Backups: `accounts-backup` writes a nightly `pg_dump` to `/volume1/docker/accounts/backups` and
keeps 14 of them.

## Phases

1. **Deployed 2026-11-12** (service + admin pages); cinema web and memories web sign-in through it are
   coded, not redeployed. The upstream keys, `ADMIN_EMAILS` and Resend are filled in by hand in `.env`.
   Mail: `RESEND_API_KEY` is a sending-only key scoped to `accounts.davideghiotto.it` (the domain
   verified in Resend), `MAIL_FROM=Homelab <noreply@accounts.davideghiotto.it>`. Set 2026-11-24;
   until then the key was empty, so no code was ever mailed: `lib/mail.ts` only logged them, and
   the logs went to Loki.
2. Devices. **Findroid TV: done in code**, emulator-verified against a throwaway Jellyfin (code + QR,
   approve, home, revoke, back to the code; see `apps/cinema/docs/ROADMAP.md`). **Memories iOS and
   Swiftfin: done in code**: email-code sign-in, "Sign In a TV" sheet, `applinks:accounts.davideghiotto.it`.
   Memories' `AccountsClientTests` runs the phone's whole job against a local accounts
   (`TEST_RUNNER_ACCOUNTS_TEST_URL=http://localhost:3190`). Universal links need the deployed AASA.
   Native clients must not keep cookies: a stored Better Auth cookie on a request with no `Origin`
   is refused (CSRF check), so their session is bearer-only.
3. **Cassette: done in code** (separate repo), as a door *beside* Clerk rather than instead of it.
   No broker: cassette has no upstream account to sign anyone into. The `jwt` plugin hands out a
   15-minute RS256 JWT at `GET /api/auth/token` (cookie or bearer), with `iss` and `aud` both
   `APP_URL` and `email`, `email_verified`, `name` in the payload; cassette's API verifies it against
   `GET /api/auth/jwks` and opens the library whose verified email matches. Needs
   `https://cassette.davideghiotto.it` in `TRUSTED_ORIGINS` (CORS with credentials). The signing key
   lives in the `jwks` table, encrypted with `BETTER_AUTH_SECRET`: rotating that secret invalidates
   it. Not an app in `APPS`, so there is no per-person grant for it yet — anyone with an account
   here can open a cassette library, which is no wider than cassette's own open Google sign-up.
