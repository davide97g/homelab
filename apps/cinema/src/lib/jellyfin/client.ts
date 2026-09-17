import { Jellyfin } from '@jellyfin/sdk'
import type { Api } from '@jellyfin/sdk'

export const CLIENT_NAME = 'Cinema'
export const CLIENT_VERSION = '0.1.0'

const DEVICE_ID_KEY = 'cinema.deviceId'

/**
 * Jellyfin ties playback sessions and "Continue Watching" to a stable device
 * id. Generate one per browser profile and keep it forever.
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
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
