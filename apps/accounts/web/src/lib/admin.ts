import { Clapperboard, Images, type LucideIcon } from 'lucide-react'
import type { Tone } from '@/components/ui.tsx'
import type { AppId } from './api.ts'

export type Upstream = { id: string; login: string; admin: boolean }

export type AppRow = {
  app: AppId
  status: 'active' | 'pending' | 'error' | string
  upstreamLogin: string | null
  lastError: string | null
  /** For an errored row: the upstream account it most likely is. */
  suggest: Upstream | null
}

export type AdminUser = {
  id: string
  email: string
  name: string
  role: string
  banned: boolean
  createdAt: string
  apps: AppRow[]
  devices: { id: string; app: AppId; deviceName: string; lastSeenAt: string }[]
}

export type Invite = {
  id: string
  email: string
  apps: AppId[]
  role: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

export type Check = {
  id: string
  group: string
  status: 'ok' | 'warn' | 'error'
  title: string
  detail: string
  fix?: string
}

export const APP_META: Record<AppId, { label: string; upstream: string; icon: LucideIcon; what: string }> = {
  cinema: { label: 'Cinema', upstream: 'Jellyfin', icon: Clapperboard, what: 'Film e serie, su web, TV e telefono' },
  memories: { label: 'Memories', upstream: 'Immich', icon: Images, what: 'Foto e video, con il backup dell\'iPhone' },
}

/** Where an app row stands, in words, and how loud to say it. */
export function describe(row: AppRow | undefined): { tone: Tone; label: string } {
  if (!row) return { tone: 'muted', label: 'Nessun accesso' }
  if (row.status === 'active') return { tone: 'ok', label: 'Attiva' }
  if (row.status === 'error')
    return row.suggest || isConflict(row) ? { tone: 'warn', label: 'Da collegare' } : { tone: 'danger', label: 'Errore' }
  return { tone: 'warn', label: 'In preparazione' }
}

/** "Esiste già un utente Immich con x: collegalo dalla pagina admin" -> it is a conflict, not an outage. */
export const isConflict = (row: AppRow) => /esiste già|already exists/i.test(row.lastError ?? '')

export const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
