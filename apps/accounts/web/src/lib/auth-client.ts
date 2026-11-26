import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/client'

/**
 * Better Auth's own client, here only for the passkey ceremonies: they need
 * the browser's WebAuthn calls glued to the server's challenge endpoints.
 * Everything else goes through `api()`.
 */
export const authClient = createAuthClient({
  baseURL: `${location.origin}/api/auth`,
  plugins: [passkeyClient()],
})

export const passkeysSupported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window

/** The browser offers saved passkeys in the email field's autofill. */
export async function conditionalUiAvailable() {
  if (!passkeysSupported()) return false
  try {
    return (await PublicKeyCredential.isConditionalMediationAvailable?.()) ?? false
  } catch {
    return false
  }
}

/** A name a person recognises in the list: "Safari su macOS". */
export function thisDeviceName() {
  const ua = navigator.userAgent
  const browser = /edg/i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser'
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : ''
  return os ? `${browser} su ${os}` : browser
}
