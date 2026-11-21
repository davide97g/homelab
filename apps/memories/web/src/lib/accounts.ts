/**
 * The homelab's single sign-on (apps/accounts). Its cookie lives on
 * .davideghiotto.it: a browser signed in there gets an Immich token here with
 * one call; otherwise it goes to sign in and comes back.
 */
export const ACCOUNTS_URL = (import.meta.env.VITE_ACCOUNTS_URL as string | undefined) ?? 'https://accounts.davideghiotto.it'

export class NeedsSignIn extends Error {}

const DEVICE_KEY = 'memories.deviceId'

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'memories-web-ephemeral'
  }
}

function deviceName() {
  const ua = navigator.userAgent
  const browser = /edg/i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser'
  const os = /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : ''
  return os ? `${browser} on ${os}` : browser
}

export async function requestImmichToken(): Promise<{ accessToken: string; userId: string }> {
  const res = await fetch(`${ACCOUNTS_URL}/api/apps/memories/token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId(), deviceName: deviceName(), client: 'Memories web', version: '1.0.0' }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) throw new NeedsSignIn()
  if (!res.ok) throw new Error(body?.error ?? `Accounts answered ${res.status}`)
  return body
}

export function goToSignIn() {
  location.assign(`${ACCOUNTS_URL}/login?next=${encodeURIComponent(location.href)}`)
}
