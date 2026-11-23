import { createPrivateKey, sign } from 'node:crypto'

/**
 * Apple's "client secret" is not a secret you are given: it is a JWT you sign
 * with the Sign in with Apple key (.p8), valid for at most six months. It is
 * minted at boot from the key itself, so nobody has to remember to rotate a
 * string in .env; every deploy restarts the container and starts a new six
 * months. A container left up longer than that stops signing people in with
 * Apple until it is restarted, which is the one thing to know about it.
 */
export function appleClientSecret(o: { teamId: string; keyId: string; clientId: string; privateKey: string }): string {
  const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'ES256', kid: o.keyId })
  const payload = b64({
    iss: o.teamId,
    iat: now,
    exp: now + 180 * 24 * 60 * 60,
    aud: 'https://appleid.apple.com',
    sub: o.clientId,
  })
  const key = createPrivateKey(o.privateKey.replace(/\\n/g, '\n'))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64(signature)}`
}
