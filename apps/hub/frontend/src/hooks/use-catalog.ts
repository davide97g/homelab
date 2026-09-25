import type { CatalogEntry } from "@wire";
import { useEffect, useState } from "react";
import { fetchCatalog } from "@/lib/api";

/** The panel catalog, fetched once per tab and shared by every page.
 *
 *  It touches nothing but a literal on the server, so it answers in milliseconds
 *  while the Prometheus queries behind the charts are still running. That gap is
 *  the whole point: a page can lay itself out, name every panel and say what it
 *  is waiting for before a single data point exists. */
let cached: Map<string, CatalogEntry> | null = null;
let inFlight: Promise<Map<string, CatalogEntry>> | null = null;

function load(): Promise<Map<string, CatalogEntry>> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= fetchCatalog()
    .then((entries) => {
      cached = new Map(entries.map((e) => [e.id, e]));
      return cached;
    })
    .catch(() => {
      // Not worth surfacing: without it the panels fall back to their ids, which
      // is worse-looking but not broken. Let the next page try again.
      inFlight = null;
      return new Map<string, CatalogEntry>();
    });
  return inFlight;
}

export function useCatalog(): (id: string) => CatalogEntry | null {
  const [entries, setEntries] = useState<Map<string, CatalogEntry>>(cached ?? new Map());

  useEffect(() => {
    let live = true;
    void load().then((next) => live && setEntries(next));
    return () => {
      live = false;
    };
  }, []);

  return (id: string) => entries.get(id) ?? null;
}
