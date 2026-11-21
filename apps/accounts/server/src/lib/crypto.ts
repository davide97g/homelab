import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../env.ts'

const key = Buffer.from(env.BROKER_KEY, 'base64')

/** AES-256-GCM, packed as base64(iv | tag | ciphertext). */
export function seal(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

export function open(sealed: string): string {
  const raw = Buffer.from(sealed, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

/** URL-safe random secret: upstream passwords, invite tokens. */
export const secret = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
