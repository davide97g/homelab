type Entry<T> = { value: T; at: number };

/** One in-flight fetch per key, result reused for `ttl`.
 *
 *  The page polls every few seconds and several browser tabs may be open; this
 *  keeps the *arr APIs from seeing a multiple of that. A refresh in flight is
 *  shared rather than duplicated. */
export class Cache {
  private store = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(private ttl: number) {}

  async get<T>(key: string, load: () => Promise<T>, ttl = this.ttl): Promise<T> {
    const hit = this.store.get(key) as Entry<T> | undefined;
    if (hit && Date.now() - hit.at < ttl) return hit.value;

    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const p = load()
      .then((value) => {
        this.store.set(key, { value, at: Date.now() });
        return value;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p;
  }

  /** Last known value regardless of age. Lets a snapshot fall back to stale
   *  numbers with a warning rather than showing nothing. */
  stale<T>(key: string): T | undefined {
    return (this.store.get(key) as Entry<T> | undefined)?.value;
  }

  clear(): void {
    this.store.clear();
  }
}
