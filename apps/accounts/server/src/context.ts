import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { Session } from './auth.ts'

export type AppEnv = {
  Variables: {
    user: Session['user'] | null
    session: Session['session'] | null
  }
}

export type AuthedEnv = { Variables: { user: Session['user']; session: Session['session'] } }

export const requireUser = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.get('user')) throw new HTTPException(401, { message: 'Accedi per continuare' })
  await next()
})

export const requireAdmin = createMiddleware<AuthedEnv>(async (c, next) => {
  const u = c.get('user')
  if (!u) throw new HTTPException(401, { message: 'Accedi per continuare' })
  if (u.role !== 'admin') throw new HTTPException(403, { message: 'Solo per admin' })
  await next()
})
