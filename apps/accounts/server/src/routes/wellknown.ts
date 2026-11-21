import { Hono } from 'hono'
import { env } from '../env.ts'

const pairs = (v?: string) =>
  (v ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split('=') as [string, string])

/**
 * Universal links / App Links. A QR on the TV points at
 * /cinema/device?user_code=… : with the app installed the phone opens it
 * there, without it the same URL is the web approval page.
 */
export const wellKnownRoutes = new Hono()
  .get('/apple-app-site-association', (c) =>
    c.json({
      applinks: {
        details: pairs(env.APPLE_APP_LINKS).map(([appID, path]) => ({
          appIDs: [appID],
          components: [{ '/': path }],
        })),
      },
      webcredentials: { apps: pairs(env.APPLE_APP_LINKS).map(([appID]) => appID) },
    }),
  )
  .get('/assetlinks.json', (c) =>
    c.json(
      pairs(env.ANDROID_APP_LINKS).map(([pkg, fingerprints]) => ({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints.split(',') },
      })),
    ),
  )
