import { Cache } from "./cache.js";
import { config } from "./config.js";
import { collectArr, collectProwlarr, radarrLibrary, sonarrLibrary } from "./services/arr.js";
import { collectBazarr } from "./services/bazarr.js";
import { collectJellyfin } from "./services/jellyfin.js";
import { collectJellyseerr } from "./services/jellyseerr.js";
import { collectQbittorrent } from "./services/qbittorrent.js";
import { HostMetrics, collectHost } from "./services/prometheus.js";
import { Snapshot } from "./services/types.js";

/** The pipeline, as described in media-pipeline.md. The frontend lays the nodes
 *  out from these positions rather than auto-layouting, because the shape *is*
 *  the information: left to right is the path a request takes. */
export type Edge = { id: string; source: string; target: string; label: string; kind?: "feedback" };

export const EDGES: Edge[] = [
  { id: "seer-radarr", source: "jellyseerr", target: "radarr", label: "movie request" },
  { id: "seer-sonarr", source: "jellyseerr", target: "sonarr", label: "series request" },
  { id: "radarr-prowlarr", source: "radarr", target: "prowlarr", label: "search" },
  { id: "sonarr-prowlarr", source: "sonarr", target: "prowlarr", label: "search" },
  { id: "prowlarr-qbit", source: "prowlarr", target: "qbittorrent", label: "grab" },
  { id: "qbit-bazarr", source: "qbittorrent", target: "bazarr", label: "import · hardlink" },
  { id: "bazarr-jellyfin", source: "bazarr", target: "jellyfin", label: "subtitles" },
  { id: "jellyfin-seer", source: "jellyfin", target: "jellyseerr", label: "available", kind: "feedback" },
];

export const POSITIONS: Record<string, { x: number; y: number }> = {
  host: { x: 0, y: 170 },
  jellyseerr: { x: 400, y: 90 },
  radarr: { x: 800, y: -150 },
  sonarr: { x: 800, y: 320 },
  prowlarr: { x: 1200, y: 110 },
  qbittorrent: { x: 1600, y: 60 },
  bazarr: { x: 2000, y: -150 },
  jellyfin: { x: 2000, y: 320 },
};

export type Overview = {
  at: string;
  host: HostMetrics & { link: string; name: string };
  services: Snapshot[];
  edges: Edge[];
  positions: Record<string, { x: number; y: number }>;
  summary: { up: number; warn: number; down: number; unconfigured: number };
};

const cache = new Cache(config.cacheMs);
const s = config.services;

/** Library listings are the only expensive calls here -- Radarr and Sonarr have
 *  no count endpoint, so the whole collection comes back. Cached far longer than
 *  the rest; a library does not change between two polls. */
const LIBRARY_TTL = 60_000;

async function collectAll(): Promise<Snapshot[]> {
  const results = await Promise.all([
    collectJellyseerr(s.jellyseerr.api, s.jellyseerr.key, s.jellyseerr.link),
    collectArr("radarr", s.radarr.api, s.radarr.key, s.radarr.link, () =>
      cache.get("radarr:library", () => radarrLibrary(s.radarr.api, s.radarr.key), LIBRARY_TTL),
    ),
    collectArr("sonarr", s.sonarr.api, s.sonarr.key, s.sonarr.link, () =>
      cache.get("sonarr:library", () => sonarrLibrary(s.sonarr.api, s.sonarr.key), LIBRARY_TTL),
    ),
    collectProwlarr(s.prowlarr.api, s.prowlarr.key, s.prowlarr.link),
    collectQbittorrent(s.qbittorrent.api, s.qbittorrent.user, s.qbittorrent.pass, s.qbittorrent.link),
    collectBazarr(s.bazarr.api, s.bazarr.key, s.bazarr.link),
    collectJellyfin(s.jellyfin.api, s.jellyfin.key, s.jellyfin.link),
  ]);
  return results;
}

export async function overview(): Promise<Overview> {
  const [services, host] = await Promise.all([
    cache.get("services", collectAll),
    cache.get("host", () => collectHost(config.prometheus.api)),
  ]);

  const summary = { up: 0, warn: 0, down: 0, unconfigured: 0 };
  for (const svc of services) summary[svc.status] += 1;

  return {
    at: new Date().toISOString(),
    host: { ...host, link: config.prometheus.link, name: config.host },
    services,
    edges: EDGES,
    positions: POSITIONS,
    summary,
  };
}
