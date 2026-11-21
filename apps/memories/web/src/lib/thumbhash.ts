import { thumbHashToDataURL } from 'thumbhash'

// Decoding is ~0.1 ms but the grid re-renders constantly while scrolling;
// keep a bounded cache keyed by the base64 hash.
const cache = new Map<string, string>()
const MAX = 4000

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function thumbhashUrl(hash: string | null | undefined): string | undefined {
  if (!hash) return undefined
  let url = cache.get(hash)
  if (url) return url
  try {
    url = thumbHashToDataURL(b64ToBytes(hash))
  } catch {
    return undefined
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string)
  cache.set(hash, url)
  return url
}
