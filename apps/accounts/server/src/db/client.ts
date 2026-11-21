import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env.ts'
import * as schema from './schema.ts'

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
})
export const db = drizzle(pool, { schema })
export type Db = typeof db
