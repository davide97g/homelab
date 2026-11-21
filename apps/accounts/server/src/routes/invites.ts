import { Hono } from 'hono'
import { lookupInvite } from '../lib/invites.ts'

/** Public: the invite page reads which email it is for before asking for a code. */
export const inviteRoutes = new Hono().get('/:token', async (c) => c.json(await lookupInvite(c.req.param('token'))))
