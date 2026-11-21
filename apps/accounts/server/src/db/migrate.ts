import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client.ts'

await migrate(db, { migrationsFolder: resolve(process.env.MIGRATIONS_DIR ?? 'drizzle') })
console.log('migrations applied')
await pool.end()
