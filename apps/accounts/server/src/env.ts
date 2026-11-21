import { z } from 'zod'

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
  )
const optional = z.preprocess((v) => v || undefined, z.string().optional())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Public origin of this service, e.g. https://accounts.davideghiotto.it */
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /**
   * 32 bytes, base64. Encrypts the random Jellyfin/Immich passwords the broker
   * signs in with. Losing it means re-provisioning every upstream account;
   * leaking it means every upstream account. Treat it like the DB itself.
   */
  BROKER_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'BROKER_KEY must be 32 bytes, base64 (openssl rand -base64 32)',
  }),
  /**
   * Parent domain for the session cookie, so every app under it shares the
   * sign-in (".davideghiotto.it"). Unset in dev: host-only cookie.
   */
  COOKIE_DOMAIN: optional,
  /** Origins allowed to call the API with the shared cookie (CORS + Better Auth trustedOrigins). */
  TRUSTED_ORIGINS: list,
  /** Become admin on first sign-in, invite or not. The bootstrap. */
  ADMIN_EMAILS: list.transform((l) => l.map((e) => e.toLowerCase())),
  /** Development only: every code is this one and nothing is mailed. Ignored in production. */
  DEV_OTP: z.preprocess((v) => v || undefined, z.string().regex(/^\d{6}$/).optional()),
  RESEND_API_KEY: optional,
  MAIL_FROM: z.string().default('Homelab <accounts@davideghiotto.it>'),

  /** Jellyfin, from inside the docker network (not the public /jf). */
  JELLYFIN_URL: optional,
  /** Dashboard > API Keys. Creates users, resets passwords, deletes devices. */
  JELLYFIN_API_KEY: optional,
  /** What cinema clients are told to use as server URL. */
  JELLYFIN_PUBLIC_URL: z.string().default('https://cinema.davideghiotto.it/jf'),
  /** Immich server root (no /api), from inside the docker network. */
  IMMICH_URL: optional,
  /** An admin's API key (all permissions). Creates users, resets passwords. */
  IMMICH_API_KEY: optional,
  IMMICH_PUBLIC_URL: z.string().default('https://memories.davideghiotto.it/immich'),

  /** Universal links: "DA596D32QB.it.davideghiotto.cinema=/cinema/*;DA596D32QB.it.davideghiotto.memories=/memories/*" */
  APPLE_APP_LINKS: optional,
  /** Android App Links: "it.davideghiotto.cinema=AA:BB:...;other.pkg=..." */
  ANDROID_APP_LINKS: optional,

  /** The built web app, served by the API in production. */
  WEB_DIST: optional,
})

export const env = schema.parse(process.env)

if (env.NODE_ENV === 'production' && env.DEV_OTP) {
  console.error('DEV_OTP is set in production: ignored, codes stay random')
  env.DEV_OTP = undefined
}

export const isProd = env.NODE_ENV === 'production'
