import { useCallback, useEffect, useRef, useState } from "react";
import { NeedsLogin, maindata } from "./qbit";
import type { Category, ServerState, Torrent } from "./types";

export type SyncState = {
  torrents: Record<string, Torrent>;
  categories: Record<string, Category>;
  server: Partial<ServerState>;
  connected: boolean;
  needsLogin: boolean;
};

const EMPTY: SyncState = {
  torrents: {},
  categories: {},
  server: {},
  connected: false,
  needsLogin: false,
};

/**
 * One poller for the whole page.
 *
 * Deltas are shallow-merged per torrent, which is what the sync protocol
 * promises: a changed torrent arrives carrying only its changed fields.
 * Polling stops while the tab is hidden -- no point paying for updates nobody
 * is looking at, and it keeps the socket count flat.
 */
export function useSync(enabled: boolean) {
  const [state, setState] = useState<SyncState>(EMPTY);
  const rid = useRef(0);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    try {
      const data = await maindata(rid.current);
      rid.current = data.rid ?? 0;
      setState((prev) => {
        const full = data.full_update === true;
        const torrents: Record<string, Torrent> = full ? {} : { ...prev.torrents };

        // `torrents` is omitted entirely when the client holds none, so an
        // absent key means "no changes", never "everything went away".
        for (const [hash, patch] of Object.entries(data.torrents ?? {})) {
          torrents[hash] = { ...(torrents[hash] ?? {}), ...patch, hash } as Torrent;
        }
        for (const hash of data.torrents_removed ?? []) delete torrents[hash];

        const categories: Record<string, Category> = full ? {} : { ...prev.categories };
        for (const [name, cat] of Object.entries(data.categories ?? {})) {
          categories[name] = { ...(categories[name] ?? {}), ...cat, name };
        }
        for (const name of data.categories_removed ?? []) delete categories[name];

        return {
          torrents,
          categories,
          server: { ...prev.server, ...data.server_state },
          connected: true,
          needsLogin: false,
        };
      });
    } catch (err) {
      if (err instanceof NeedsLogin) {
        rid.current = 0;
        setState((prev) => ({ ...prev, needsLogin: true, connected: false }));
      } else {
        setState((prev) => ({ ...prev, connected: false }));
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** Call after an action so the change shows immediately instead of next tick. */
  const refresh = useCallback(() => {
    void tick();
  }, [tick]);

  useEffect(() => {
    if (!enabled) return;
    void tick();
    // The server states its own preferred cadence (1500 ms here); honour it
    // rather than inventing a number.
    const interval = state.server.refresh_interval ?? 1500;
    timer.current = window.setInterval(() => void tick(), interval);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, tick, state.server.refresh_interval]);

  return { ...state, refresh };
}
