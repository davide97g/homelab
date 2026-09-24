import { Cache } from "../cache.js";
import { config } from "../config.js";
import { display } from "../format.js";
import { soft } from "../http.js";
import { byLabel } from "../prom/client.js";
import type { MediaEdge, MediaNode, MediaPipeline, Status } from "../wire.js";
import { collectArr, collectProwlarr, radarrLibrary, sonarrLibrary } from "./collect/arr.js";
import { collectBazarr } from "./collect/bazarr.js";
import { collectJellyfin } from "./collect/jellyfin.js";
import { collectJellyseerr } from "./collect/jellyseerr.js";
import { collectKavita, collectSuwayomi, collectYomu } from "./collect/manga.js";
import { collectQbittorrent } from "./collect/qbittorrent.js";
import type { Collected, Flow } from "./collect/shape.js";

// The pipeline as a graph: one node per service, edges in the order a request
// actually travels, live numbers on each card.
//
// This is the read side of the media stack, and it is the page that replaced
// mediarr-dash. The shape below is that app's, which was right; what is new is
// that the *host* is not in this payload (the page already holds /api/summary,
// and one machine should have one source of numbers) and that busy edges are
// decided here from the collectors' own figures rather than in the browser by
// parsing stat strings.

/** Left to right is the path a request takes, which is why nothing here is
 *  auto-laid-out: the shape is the information. The one edge that runs the other
 *  way is availability, and it is drawn below the row so it does not double back
 *  across every node.
 *
 *  Kept on the server, like the topology graph, so the two halves cannot
 *  disagree about what the pipeline looks like. */
export const POSITIONS: Record<string, { x: number; y: number }> = {
  jellyseerr: { x: 0, y: 90 },
  radarr: { x: 380, y: -150 },
  sonarr: { x: 380, y: 320 },
  prowlarr: { x: 760, y: 85 },
  qbittorrent: { x: 1140, y: 85 },
  bazarr: { x: 1520, y: -150 },
  jellyfin: { x: 1520, y: 320 },
  // The manga lane, its own row under the film one: a separate stack with
  // nothing in common except the box, so no edge joins the two. Low enough to
  // clear the availability edge, which loops under the row above.
  suwayomi: { x: 0, y: 700 },
  kavita: { x: 760, y: 700 },
  yomu: { x: 1520, y: 700 },
};

type EdgeSpec = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: MediaEdge["kind"];
  note: string;
  /** What has to be true for something to be moving along it. Reads the
   *  collectors' raw numbers, never their rendered strings. */
  busy: (flow: Record<string, Flow>) => boolean;
};

const n = (flow: Record<string, Flow>, id: string, key: string): number => flow[id]?.[key] ?? 0;

const EDGES: EdgeSpec[] = [
  {
    id: "seer-radarr",
    from: "jellyseerr",
    to: "radarr",
    label: "movie request",
    kind: "forward",
    note: "Busy while a request is pending or still processing.",
    busy: (f) => n(f, "jellyseerr", "pending") + n(f, "jellyseerr", "processing") > 0,
  },
  {
    id: "seer-sonarr",
    from: "jellyseerr",
    to: "sonarr",
    label: "series request",
    kind: "forward",
    note: "Busy while a request is pending or still processing.",
    busy: (f) => n(f, "jellyseerr", "pending") + n(f, "jellyseerr", "processing") > 0,
  },
  {
    id: "radarr-prowlarr",
    from: "radarr",
    to: "prowlarr",
    label: "search",
    kind: "forward",
    note: "Busy while Radarr has anything in its queue.",
    busy: (f) => n(f, "radarr", "queue") > 0,
  },
  {
    id: "sonarr-prowlarr",
    from: "sonarr",
    to: "prowlarr",
    label: "search",
    kind: "forward",
    note: "Busy while Sonarr has anything in its queue.",
    busy: (f) => n(f, "sonarr", "queue") > 0,
  },
  {
    id: "prowlarr-qbit",
    from: "prowlarr",
    to: "qbittorrent",
    label: "grab",
    kind: "forward",
    note: "Busy while bytes are actually arriving.",
    busy: (f) => n(f, "qbittorrent", "downBytesPerSec") > 0,
  },
  {
    id: "qbit-bazarr",
    from: "qbittorrent",
    to: "bazarr",
    label: "import · hardlink",
    kind: "forward",
    note: "Busy while a download is running — the import that follows it is what Bazarr waits on.",
    busy: (f) => n(f, "qbittorrent", "downBytesPerSec") > 0 || n(f, "qbittorrent", "active") > 0,
  },
  {
    id: "bazarr-jellyfin",
    from: "bazarr",
    to: "jellyfin",
    label: "subtitles",
    kind: "forward",
    note: "Busy while Bazarr still wants a subtitle for something.",
    busy: (f) => n(f, "bazarr", "wanted") > 0,
  },
  {
    id: "jellyfin-seer",
    from: "jellyfin",
    to: "jellyseerr",
    label: "available",
    kind: "feedback",
    // The availability edge runs against the pipeline: it is the library telling
    // the front door that the thing someone asked for finally exists.
    note: "Runs backwards on purpose: the library telling the front door the file exists. Animated while something is playing.",
    busy: (f) => n(f, "jellyfin", "playing") > 0,
  },
  {
    id: "suwayomi-kavita",
    from: "suwayomi",
    to: "kavita",
    label: "CBZ files",
    kind: "forward",
    note: "A shared folder, not an API: Suwayomi writes CBZs and Kavita's folder watcher indexes them a few minutes later. Busy while chapters are downloading.",
    busy: (f) => n(f, "suwayomi", "running") > 0 && n(f, "suwayomi", "queue") > 0,
  },
  {
    id: "kavita-yomu",
    from: "kavita",
    to: "yomu",
    label: "reads",
    kind: "forward",
    note: "Yomu proxies only the reader's routes to Kavita. Kavita has no live-reader count to animate this by, so it stays still.",
    busy: () => false,
  },
];

/** Cached apart from everything else and for far longer: the *arr library
 *  listings are the only expensive calls in this payload — neither app has a
 *  count endpoint, so the whole collection comes back — and a library does not
 *  change between two five-second polls. */
const LIBRARY_TTL_MS = 60_000;

const cache = new Cache(config.cacheMs);

/** What each service is costing the box, from cAdvisor. Every one of these runs
 *  on the mini PC; Jellyfin is the exception and runs on the NAS, so it has no
 *  row here and its card says nothing rather than implying zero. */
async function containerLoad(): Promise<Map<string, { cpuPercent: number; rssBytes: number | null }>> {
  const [cpu, rss] = await Promise.all([
    byLabel(`sum by (name) (rate(container_cpu_usage_seconds_total{instance="homelab",name!=""}[2m])) * 100`, "name"),
    byLabel(`sum by (name) (container_memory_working_set_bytes{instance="homelab",name!=""})`, "name"),
  ]);

  const out = new Map<string, { cpuPercent: number; rssBytes: number | null }>();
  for (const [name, value] of cpu) out.set(name, { cpuPercent: value, rssBytes: rss.get(name) ?? null });
  for (const [name, value] of rss) {
    if (!out.has(name)) out.set(name, { cpuPercent: 0, rssBytes: value });
  }
  return out;
}

/** Node id to the container name cAdvisor reports. They match today; the map
 *  exists so a renamed container is one line here rather than a silently empty
 *  footer. */
const CONTAINER_BY_NODE: Record<string, string> = {
  jellyseerr: "jellyseerr",
  radarr: "radarr",
  sonarr: "sonarr",
  prowlarr: "prowlarr",
  qbittorrent: "qbittorrent",
  bazarr: "bazarr",
  suwayomi: "suwayomi",
  kavita: "kavita",
  yomu: "yomu",
};

async function assemble(): Promise<MediaPipeline> {
  const [collected, load] = await Promise.all([
    Promise.all([
      collectJellyseerr(),
      collectArr("radarr", () => cache.get("radarr:library", radarrLibrary, LIBRARY_TTL_MS)),
      collectArr("sonarr", () => cache.get("sonarr:library", sonarrLibrary, LIBRARY_TTL_MS)),
      collectProwlarr(),
      collectQbittorrent(),
      collectBazarr(),
      collectJellyfin(),
      collectSuwayomi(),
      collectKavita(),
      collectYomu(),
    ]),
    soft(containerLoad()),
  ]);

  const flow: Record<string, Flow> = {};
  const nodes: MediaNode[] = collected.map((c: Collected) => {
    flow[c.node.id] = c.flow;
    const container = CONTAINER_BY_NODE[c.node.id];
    const row = container ? load?.get(container) : undefined;
    return {
      ...c.node,
      kind: "service",
      position: POSITIONS[c.node.id] ?? { x: 0, y: 0 },
      load: row
        ? { cpuPercent: row.cpuPercent, rssBytes: row.rssBytes, rssDisplay: display(row.rssBytes, "bytes") }
        : null,
    };
  });

  const status = new Map<string, Status>(nodes.map((node) => [node.id, node.status]));
  const edges: MediaEdge[] = EDGES.map((spec) => {
    // A path through a service that is not answering carries nothing, whatever
    // the numbers either side of it say. Those numbers are the last ones read,
    // and animating them would be drawing a flow that has stopped.
    const broken = status.get(spec.from) !== "up" && status.get(spec.from) !== "warn";
    const brokenTo = status.get(spec.to) !== "up" && status.get(spec.to) !== "warn";
    return {
      id: spec.id,
      from: spec.from,
      to: spec.to,
      label: spec.label,
      kind: spec.kind,
      active: !broken && !brokenTo && spec.busy(flow),
      note: spec.note,
    };
  });

  const counts = { up: 0, warn: 0, down: 0, unconfigured: 0 };
  for (const node of nodes) counts[node.status] += 1;

  const notes = [
    "Everything except Jellyfin runs on the mini PC. Jellyfin is on the NAS, which is why its card has no CPU or memory line — cAdvisor there is a different scrape and the pipeline does not need it twice.",
    "The bottom row is the manga stack (~/manga): Suwayomi and Kavita are LAN only, and Yomu is the one public door, at manga.davideghiotto.it.",
    "A request is Processing from the moment it imports until the nightly copy lands on the NAS, not Available. The library is copied, not mounted: the NAS is on a different physical network.",
  ];
  if (counts.unconfigured > 0) {
    notes.push(
      "A node with no key is not a broken node. Run scripts/collect-env.sh on the box and restart the hub to fill it in.",
    );
  }

  return { at: new Date().toISOString(), stale: false, nodes, edges, counts, notes };
}

/** Ten services, each with its own timeout, run against a budget the way
 *  /api/summary is: past it the last good payload is served with `stale: true`
 *  rather than letting one sick service hold the page. */
export async function pipeline(): Promise<MediaPipeline> {
  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), config.mediaBudgetMs));
  const fresh = cache.get("pipeline", assemble);

  const won = await Promise.race([fresh, budget]);
  if (won) return won;

  const last = cache.stale<MediaPipeline>("pipeline");
  if (last) return { ...last, stale: true };
  return fresh;
}
