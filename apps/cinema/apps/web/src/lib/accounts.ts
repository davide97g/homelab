import { CLIENT_NAME, CLIENT_VERSION, getDeviceId } from './jellyfin/client'

/**
 * The homelab's single sign-on (apps/accounts). Its session cookie lives on
 * .davideghiotto.it, so a browser already signed in there gets a Jellyfin
 * token here with one call; otherwise it goes to sign in and comes back.
 */
export const ACCOUNTS_URL = (import.meta.env.VITE_ACCOUNTS_URL as string | undefined) ?? 'https://accounts.davideghiotto.it'

export class NeedsSignIn extends Error {}

export type BrokeredToken = { accessToken: string; userId: string; serverUrl: string }

function deviceName() {
  const ua = navigator.userAgent
  const browser = /edg/i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser'
  const os = /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : ''
  return os ? `${browser} on ${os}` : browser
}

/** Throws NeedsSignIn when there is no accounts session (or no Cinema access: the message says). */
export async function requestJellyfinToken(): Promise<BrokeredToken> {
  const res = await fetch(`${ACCOUNTS_URL}/api/apps/cinema/token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId(), deviceName: deviceName(), client: CLIENT_NAME, version: CLIENT_VERSION }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) throw new NeedsSignIn()
  if (!res.ok) throw new Error(body?.error ?? `Accounts answered ${res.status}`)
  return body as BrokeredToken
}

export function goToSignIn() {
  location.assign(`${ACCOUNTS_URL}/login?next=${encodeURIComponent(location.href)}`)
}
