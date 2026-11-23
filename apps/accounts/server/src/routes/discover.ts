import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { isStale, readPipeline } from '../lib/pipeline.ts'
import * as jellyfin from '../upstream/jellyfin.ts'
import { UpstreamError } from '../upstream/http.ts'
import * as seerr from '../upstream/seerr.ts'

/**
 * /api/discover/* — cinema's Discover, backed by Seerr.
 *
 * Clients send the Jellyfin token they already hold (`Authorization: Bearer <token>`):
 * web, TV and iPhone alike, no Seerr sign-in. The token says which Jellyfin user is asking,
 * that user maps to their Seerr user (imported on first use), and the call goes to Seerr
 * with the API key acting as them. Only the paths below get through; Seerr's settings,
 * users and media management stay out of reach.
 */

const GET_PATHS = [
  /^discover\/(trending|movies|tv|movies\/upcoming|tv\/upcoming)$/,
  /^discover\/(movies|tv)\/genre\/\d+$/,
  /^discover\/genreslider\/(movie|tv)$/,
  /^search$/,
  /^movie\/\d+(\/(recommendations|similar))?$/,
  /^tv\/\d+(\/(recommendations|similar|season\/\d+))?$/,
  /^genres\/(movie|tv)$/,
  /^request$/,
]

/** What a client may ask for: the server picks quality, folder and profile (HD ITA). */
const requestBody = z.object({
  mediaType: z.enum(['movie', 'tv']),
  mediaId: z.number().int().positive(),
  seasons: z.union([z.array(z.number().int().min(0)).min(1), z.literal('all')]).optional(),
})

/** Fields that must not leave Seerr: other people's emails, internal URLs, tokens. */
const SCRUB = new Set([
  'email',
  'jellyfinAuthToken',
  'plexToken',
  'resetPasswordGuid',
  'recoveryLinkExpirationDate',
  'settings',
  'warnings',
  'mediaUrl',
  'mediaUrl4k',
  'serviceUrl',
  'serviceUrl4k',
])

function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (!SCRUB.has(k)) out[k] = scrub(x)
    return out
  }
  return v
}

// Every Discover screen fires several calls; neither Jellyfin nor Seerr needs asking
// each time who the token belongs to.
const TTL = 5 * 60_000
const tokens = new Map<string, { jellyfinId: string; at: number }>()
const users = new Map<string, { user: seerr.SeerrUser; at: number }>()

function fresh<T extends { at: number }>(map: Map<string, T>, key: string) {
  const hit = map.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit
  map.delete(key)
  return undefined
}

async function jellyfinIdFor(token: string) {
  const hit = fresh(tokens, token)
  if (hit) return hit.jellyfinId
  try {
    const me = await jellyfin.whoAmI(token)
    if (tokens.size > 500) tokens.clear()
    tokens.set(token, { jellyfinId: me.Id, at: Date.now() })
    return me.Id
  } catch (e) {
    if (e instanceof UpstreamError && (e.status === 401 || e.status === 403))
      throw new HTTPException(401, { message: 'Accesso a Jellyfin scaduto: rientra' })
    throw e
  }
}

async function seerrUserFor(jellyfinId: string) {
  const hit = fresh(users, jellyfinId)
  if (hit) return hit.user
  let user = await seerr.userByJellyfinId(jellyfinId)
  if (!user) {
    // First time in Discover: Seerr imports them from Jellyfin with its default permissions.
    await seerr.importFromJellyfin(jellyfinId)
    user = await seerr.userByJellyfinId(jellyfinId)
  }
  if (!user) throw new HTTPException(403, { message: 'Seerr non riconosce questo utente Jellyfin' })
  users.set(jellyfinId, { user, at: Date.now() })
  return user
}

type Vars = { Variables: { seerrUser: seerr.SeerrUser } }

function reply(c: { json: (b: unknown, s: ContentfulStatusCode) => Response; body: (b: null, s: 204) => Response }, r: { status: number; body: unknown }) {
  if (r.status === 204) return c.body(null, 204)
  if (r.status >= 400) {
    const message = (r.body as { message?: string } | null)?.message
    return c.json({ error: message || `Seerr ha risposto ${r.status}` }, r.status as ContentfulStatusCode)
  }
  return c.json(scrub(r.body), r.status as ContentfulStatusCode)
}

export const discoverRoutes = new Hono<Vars>()
  .use(async (c, next) => {
    if (!seerr.seerrEnabled()) throw new HTTPException(503, { message: 'Discover non configurato (SEERR_URL, SEERR_API_KEY)' })
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token) throw new HTTPException(401, { message: 'Token mancante' })
    c.set('seerrUser', await seerrUserFor(await jellyfinIdFor(token)))
    await next()
  })

  /** Who Seerr thinks you are, and what you may do: the UI hides buttons it would refuse. */
  .get('/me', (c) => {
    const u = c.get('seerrUser')
    return c.json({
      id: u.id,
      displayName: u.displayName,
      canRequest: { movie: seerr.canRequest(u.permissions, 'movie'), tv: seerr.canRequest(u.permissions, 'tv') },
      autoApprove: { movie: seerr.autoApproved(u.permissions, 'movie'), tv: seerr.autoApproved(u.permissions, 'tv') },
    })
  })

  .post('/request', async (c) => {
    const parsed = requestBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new HTTPException(400, { message: 'Richiesta non valida' })
    const { mediaType, mediaId, seasons } = parsed.data
    const body = { mediaType, mediaId, is4k: false, ...(mediaType === 'tv' ? { seasons: seasons ?? 'all' } : {}) }
    const r = await seerr.asUser(c.get('seerrUser').id, '/request', { method: 'POST', body: JSON.stringify(body) })
    return reply(c, r)
  })

  // Seerr itself only lets you withdraw your own request while it is still pending.
  .delete('/request/:id{[0-9]+}', async (c) => {
    const r = await seerr.asUser(c.get('seerrUser').id, `/request/${c.req.param('id')}`, { method: 'DELETE' })
    return reply(c, r)
  })

  /**
   * Download and NAS-copy progress for some titles (`?keys=movie:603,tv:1396`), from the
   * mini PC's report. A title missing from `titles` has nothing moving right now.
   */
  .get('/progress', async (c) => {
    const keys = (c.req.query('keys') ?? '')
      .split(',')
      .filter((k) => /^(movie|tv):\d+$/.test(k))
      .slice(0, 50)
    const doc = await readPipeline()
    if (!doc) return c.json({ available: false, at: null, stale: true, sync: null, titles: {} })
    const titles = Object.fromEntries(keys.filter((k) => doc.titles[k]).map((k) => [k, doc.titles[k]]))
    return c.json({ available: true, at: doc.at, stale: isStale(doc), sync: doc.sync, titles })
  })

  .get('/*', async (c) => {
    const path = c.req.path.replace(/^.*?\/discover\//, '')
    if (!GET_PATHS.some((re) => re.test(path))) throw new HTTPException(404, { message: 'Non trovato' })
    const query = new URL(c.req.url).searchParams
    // The request list is always your own, whatever the client asked for.
    if (path === 'request') query.set('requestedBy', String(c.get('seerrUser').id))
    // Not URLSearchParams.toString(): its "+" for a space is rejected by Seerr's validator.
    const qs = [...query].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    const r = await seerr.asUser(c.get('seerrUser').id, `/${path}${qs ? `?${qs}` : ''}`)
    return reply(c, r)
  })
