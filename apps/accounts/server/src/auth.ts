import { APIError, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, bearer, deviceAuthorization, emailOTP, jwt } from 'better-auth/plugins'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from './db/client.ts'
import * as schema from './db/schema.ts'
import { env, isProd } from './env.ts'
import { appleClientSecret } from './lib/apple.ts'
import { sendCode } from './lib/mail.ts'
import { acceptInvite } from './lib/invites.ts'

/** The clients allowed to start a device sign-in (the TV apps), and the app each one is for. */
export const DEVICE_CLIENTS: Record<string, schema.AppId> = {
  'cinema-tv': 'cinema',
  'memories-tv': 'memories',
}

async function liveInvite(email: string) {
  const [inv] = await db
    .select()
    .from(schema.invite)
    .where(
      and(
        eq(schema.invite.email, email.toLowerCase()),
        isNull(schema.invite.acceptedAt),
        isNull(schema.invite.revokedAt),
        gt(schema.invite.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return inv
}

const isAdminEmail = (email: string) => env.ADMIN_EMAILS.includes(email.toLowerCase())

const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' as const }
    : null
const apple =
  env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
    ? {
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: appleClientSecret({
          teamId: env.APPLE_TEAM_ID,
          keyId: env.APPLE_KEY_ID,
          clientId: env.APPLE_CLIENT_ID,
          privateKey: env.APPLE_PRIVATE_KEY,
        }),
        // An id token minted for the web (Services ID) or for a native app.
        audience: [env.APPLE_CLIENT_ID, ...env.APPLE_APP_BUNDLE_IDS],
      }
    : null

/** Which social buttons to draw: here, and in every app that signs in through this service. */
export const SOCIAL = { google: !!google, apple: !!apple }

/**
 * One account per person, no passwords: a 6-digit code by email, or Google or
 * Apple where they are configured. Nobody signs up on their own, whichever door
 * they use: an account is born from an admin's invite (or from ADMIN_EMAILS, the
 * bootstrap), and the user-create hook below refuses everyone else — a Google
 * sign-in by a stranger fails exactly like a code for a stranger's email.
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  // Apple answers the sign-in with a form POST from its own origin.
  trustedOrigins: [env.APP_URL, ...env.TRUSTED_ORIGINS, ...(apple ? ['https://appleid.apple.com'] : [])],
  socialProviders: { ...(google ? { google } : {}), ...(apple ? { apple } : {}) },
  account: {
    // Somebody invited by email who later presses "Continue with Google" with
    // that same address is the same person: Google and Apple both verify the
    // email they hand over, so their sign-in joins the existing account rather
    // than being refused as a duplicate.
    accountLinking: { enabled: true, trustedProviders: ['google', 'apple', 'email-otp'] },
  },
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  session: {
    // A TV signs in once and stays: 1 year, sliding.
    expiresIn: 60 * 60 * 24 * 365,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    crossSubDomainCookies: env.COOKIE_DOMAIN ? { enabled: true, domain: env.COOKIE_DOMAIN } : undefined,
    useSecureCookies: isProd,
  },
  plugins: [
    admin({ adminRoles: ['admin'] }),
    bearer(),
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      // Spread, not `generateOTP: undefined`: an explicit undefined replaces the plugin's default
      // generator, and production then 500s on every code.
      ...(env.DEV_OTP ? { generateOTP: () => env.DEV_OTP as string } : {}),
      async sendVerificationOTP({ email, otp }) {
        // Codes only go to people who can use them: no mailing strangers.
        const known = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email.toLowerCase()))
        if (!known.length && !isAdminEmail(email) && !(await liveInvite(email))) return
        await sendCode(email, otp)
      },
    }),
    // Cassette (phase 3) does not use the broker: it has no upstream account to sign
    // anyone into, and this is its only sign-in. Its web app trades the shared cookie for a 15-minute JWT at
    // GET /api/auth/token and its API checks the signature against /api/auth/jwks.
    // RS256 rather than the default EdDSA so the API verifies these exactly as it
    // verifies Clerk's. A ban or a revoked session stops new tokens at once; one
    // already handed out lives out its 15 minutes.
    jwt({
      disableSettingJwtHeader: true,
      jwks: { keyPairConfig: { alg: 'RS256', modulusLength: 2048 } },
      jwt: {
        issuer: env.APP_URL,
        audience: env.APP_URL,
        expirationTime: '15m',
        definePayload: ({ user }) => ({
          email: user.email,
          email_verified: user.emailVerified,
          name: user.name,
          image: user.image ?? null,
        }),
      },
    }),
    deviceAuthorization({
      expiresIn: '10m',
      interval: '5s',
      userCodeLength: 8,
      verificationUri: `${env.APP_URL}/device`,
      validateClient: (clientId) => clientId in DEVICE_CLIENTS,
    }),
  ],
  rateLimit: {
    enabled: isProd,
    customRules: {
      '/email-otp/send-verification-otp': { window: 600, max: 5 },
      '/sign-in/email-otp': { window: 600, max: 10 },
      '/device/code': { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          const email = newUser.email.toLowerCase()
          const inv = await liveInvite(email)
          if (!inv && !isAdminEmail(email)) throw new APIError('FORBIDDEN', { message: 'Serve un invito per entrare' })
          const name = newUser.name?.trim() || email.split('@')[0] || 'Utente'
          const role = isAdminEmail(email) ? 'admin' : (inv?.role ?? 'user')
          return { data: { ...newUser, email, name, role } }
        },
        after: async (created) => {
          await acceptInvite(created.id, created.email)
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
