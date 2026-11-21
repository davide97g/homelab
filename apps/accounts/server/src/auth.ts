import { APIError, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, bearer, deviceAuthorization, emailOTP } from 'better-auth/plugins'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from './db/client.ts'
import * as schema from './db/schema.ts'
import { env, isProd } from './env.ts'
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

/**
 * One account per person, one 6-digit code by email to sign in, no passwords.
 * Nobody signs up on their own: an account is born from an admin's invite (or
 * from ADMIN_EMAILS, the bootstrap).
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL, ...env.TRUSTED_ORIGINS],
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
