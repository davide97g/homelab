/** Fixed-window rate limit, in memory, keyed by whatever the caller passes.
 *
 *  mediarr-dash has this inline in index.ts because login is the only thing
 *  that needs it. Here the write actions need the same mechanism with different
 *  numbers, so it is a function instead of a closure over one Map.
 *
 *  One process, one user: nothing shared, nothing persisted. A restart forgives
 *  everyone, which is the right trade for a homelab. */
const windows = new Map<string, { count: number; first: number }>();

export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || now - entry.first > windowMs) {
    windows.set(key, { count: 1, first: now });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

export function forgive(key: string): void {
  windows.delete(key);
}

/** The address a request came from, as far as it can be known. Cloudflare sets
 *  cf-connecting-ip; behind nothing at all there is no address worth having, so
 *  every local caller shares one bucket. */
export function clientIp(header: (k: string) => string | undefined): string {
  return (
    header("cf-connecting-ip") ??
    header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}
