import { Jellyfin } from '@jellyfin/sdk'
import type { Api } from '@jellyfin/sdk'

export const CLIENT_NAME = 'Cinema'
export const CLIENT_VERSION = '0.1.0'

const DEVICE_ID_KEY = 'cinema.deviceId'

/**
 * `crypto.randomUUID` exists only in a secure context, so it is undefined on
 * a plain-HTTP LAN origin like http://debian:8898 -- the mini PC copy, which
 * has no certificate. `crypto.getRandomValues` is not restricted that way, so
 * the v4 UUID is assembled by hand when the built-in is missing.
 */
function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Jellyfin ties playback sessions and "Continue Watching" to a stable device
 * id. Generate one per browser profile and keep it forever.
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = randomUuid()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

function getDeviceName(): string {
  const ua = navigator.userAgent
  if (/edg/i.test(ua)) return 'Edge'
  if (/chrome/i.test(ua)) return 'Chrome'
  if (/firefox/i.test(ua)) return 'Firefox'
  if (/safari/i.test(ua)) return 'Safari'
  return 'Browser'
}

export const jellyfin = new Jellyfin({
  clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  deviceInfo: { name: getDeviceName(), id: getDeviceId() },
})

/**
 * A RELATIVE base path. The SDK passes it straight to axios without
 * normalising, so every request resolves against our own origin and gets
 * forwarded by the Vite dev proxy (see vite.config.ts). No CORS, ever.
 *
 * In production, put this app and Jellyfin behind one reverse proxy and keep
 * this value as-is.
 */
export const SERVER_BASE = '/jf'

export function createApi(accessToken?: string): Api {
  return jellyfin.createApi(SERVER_BASE, accessToken)
}
