import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const at = (name: string) => timestamp(name, { withTimezone: true })
const timestamps = {
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID())

/** The apps the broker knows how to sign people into. Cassette joins in phase 3. */
export const APPS = ['cinema', 'memories'] as const
export type AppId = (typeof APPS)[number]

// --- Better Auth (core + admin + device-authorization) ----------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** `admin` manages users, invites and devices; `user` only their own. */
  role: text('role').notNull().default('user'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: at('ban_expires'),
  ...timestamps,
})

/**
 * The jwt plugin's signing keys. Cassette verifies the short-lived JWTs that
 * `/api/auth/token` hands out against `/api/auth/jwks`, so it never has to ask
 * this service who a request is from. Private keys are encrypted with
 * BETTER_AUTH_SECRET by the plugin itself.
 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  alg: text('alg'),
  crv: text('crv'),
  createdAt: at('created_at').notNull(),
  expiresAt: at('expires_at'),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: at('expires_at').notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
    ...timestamps,
  },
  (t) => [index('session_user_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: at('access_token_expires_at'),
    refreshTokenExpiresAt: at('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('account_user_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: at('expires_at').notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

/** RFC 8628 codes: the TV shows `userCode`, polls with `deviceCode`. */
export const deviceCode = pgTable(
  'device_code',
  {
    id: text('id').primaryKey(),
    deviceCode: text('device_code').notNull(),
    userCode: text('user_code').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: at('expires_at').notNull(),
    status: text('status').notNull(),
    lastPolledAt: at('last_polled_at'),
    pollingInterval: integer('polling_interval'),
    clientId: text('client_id'),
    scope: text('scope'),
    ...timestamps,
  },
  (t) => [uniqueIndex('device_code_device_code_idx').on(t.deviceCode), uniqueIndex('device_code_user_code_idx').on(t.userCode)],
)

// --- Ours --------------------------------------------------------------------

/**
 * An admin's invitation. Only the hash of the token is kept: the link in the
 * email is the only copy. Signing up is refused for any email without a live
 * invite (or in ADMIN_EMAILS).
 */
export const invite = pgTable(
  'invite',
  {
    id: id(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    apps: text('apps').array().notNull().default(sql`'{}'::text[]`),
    role: text('role').notNull().default('user'),
    expiresAt: at('expires_at').notNull(),
    acceptedAt: at('accepted_at'),
    revokedAt: at('revoked_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('invite_email_idx').on(t.email)],
)

/**
 * A user's account in one upstream app. The password is random, encrypted with
 * BROKER_KEY, and never shown to anyone: the broker signs in with it and hands
 * the app's own token to the client.
 */
export const appAccess = pgTable(
  'app_access',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    app: text('app').$type<AppId>().notNull(),
    /** Jellyfin user id / Immich user id. Null while provisioning has not run (or failed). */
    upstreamUserId: text('upstream_user_id'),
    /** Jellyfin username / Immich email: what the broker signs in as. */
    upstreamLogin: text('upstream_login'),
    passwordEnc: text('password_enc'),
    /** `active`, or `pending` (granted, upstream not created yet), or `error`. */
    status: text('status').notNull().default('pending'),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.app] })],
)

/**
 * Every native token the broker handed out, so an admin (or the user) can see
 * where they are signed in and pull the plug: the Better Auth session goes, and
 * so does the upstream device/session.
 */
export const deviceGrant = pgTable(
  'device_grant',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    app: text('app').$type<AppId>().notNull(),
    /** The client's own device id (Jellyfin DeviceId), stable across sign-ins. */
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name').notNull(),
    /** The Better Auth session that asked for the token, if still around. */
    sessionId: text('session_id'),
    /** Encrypted upstream token: Immich needs it to log the session out. */
    upstreamTokenEnc: text('upstream_token_enc'),
    lastSeenAt: at('last_seen_at').notNull().defaultNow(),
    revokedAt: at('revoked_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('device_grant_user_app_device_idx').on(t.userId, t.app, t.deviceId)],
)
