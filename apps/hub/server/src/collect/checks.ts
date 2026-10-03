import { Cache } from "../cache.js";
import { config } from "../config.js";
import { dockerConfigured, listContainers } from "../docker/client.js";
import { getJson } from "../http.js";
import { vpnConfigured, vpnSnapshot } from "../media/vpn.js";
import { dnsCheck } from "../dns/failover.js";
import type { Alert, Check, CheckContainer, CheckLevel, Checks } from "../wire.js";

// The invariants a deploy has to leave standing, asked of the services
// themselves rather than of their healthchecks.
//
// A container healthcheck answers "is the port up", and that is not what broke
// on 2026-09-27: Jellyfin 12.1 came up healthy with hardware acceleration
// silently reset to none. So each check here reads the setting or the verdict
// that matters -- the *arr's own health list, Jellyfin's encoding config, the
// VPN's leak test -- and says in a sentence what is wrong.
//
// CI reads this after every deploy (.github/workflows/verify-deploy.yml) and the
// home page's alert strip shows whatever is not ok.

const cache = new Cache(15_000);

const rank: Record<CheckLevel, number> = { ok: 0, warn: 1, pending: 2, fail: 3 };

function worst(levels: CheckLevel[]): CheckLevel {
  return levels.reduce<CheckLevel>((a, b) => (rank[b] > rank[a] ? b : a), "ok");
}

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs one check and turns a throw into a failing row, so a dead service is a
 *  red line with its reason rather than a missing one. */
async function run(id: string, label: string, body: () => Promise<Omit<Check, "id" | "label">>): Promise<Check> {
  try {
    return { id, label, ...(await body()) };
  } catch (err) {
    return { id, label, level: "fail", detail: `unreachable: ${why(err)}` };
  }
}

/** Every container on the box, running or not, from the Docker API. */
async function containers(seen: CheckContainer[]): Promise<Omit<Check, "id" | "label">> {
  const rows = await listContainers();
  const bad: string[] = [];
  const starting: string[] = [];
  const idle: string[] = [];

  for (const c of rows) {
    const name = (c.Names[0] ?? c.Id).replace(/^\//, "");
    seen.push({ name, image: c.Image, state: c.State, status: c.Status });
    if (c.State === "running") {
      if (c.Status.includes("(unhealthy)")) bad.push(`${name} unhealthy`);
      else if (c.Status.includes("(health: starting)")) starting.push(name);
    } else if (c.State === "exited") {
      // An exit 0 is a one-shot that finished, or a Swarm task replaced by a
      // newer one; anything else died.
      const code = Number(/Exited \((\d+)\)/.exec(c.Status)?.[1] ?? "1");
      (code === 0 ? idle : bad).push(`${name} exited ${code}`);
    } else if (c.State === "created" || c.State === "paused") {
      idle.push(`${name} ${c.State}`);
    } else {
      bad.push(`${name} ${c.State}`);
    }
  }

  if (bad.length) return { level: "fail", detail: bad.join(", ") };
  if (starting.length) return { level: "pending", detail: `health starting: ${starting.join(", ")}` };
  if (idle.length) return { level: "warn", detail: `${rows.length} containers; not running: ${idle.join(", ")}` };
  return { level: "ok", detail: `${rows.length} containers running` };
}

type HealthItem = { source?: string; type?: string; message?: string };

/** Radarr, Sonarr and Prowlarr share one health list: `error` is a broken
 *  dependency (a download client or indexer that cannot be reached), `warning`
 *  is advice. Only the first stops a deploy. */
async function arrHealth(target: { url: string; key: string }, version: "v1" | "v3"): Promise<Omit<Check, "id" | "label">> {
  if (!target.key) return { level: "warn", detail: "API key not collected on the box" };
  const items = await getJson<HealthItem[]>(`${target.url}/api/${version}/health`, {
    headers: { "x-api-key": target.key },
  });
  const errors = (items ?? []).filter((i) => i.type === "error");
  const warnings = (items ?? []).filter((i) => i.type === "warning");
  const say = (list: HealthItem[]) => list.map((i) => i.message ?? i.source ?? "?").join("; ");
  if (errors.length) return { level: "fail", detail: say(errors) };
  if (warnings.length) return { level: "warn", detail: say(warnings) };
  return { level: "ok", detail: "no health issues" };
}

async function bazarrHealth(): Promise<Omit<Check, "id" | "label">> {
  const { url, key } = config.bazarr;
  if (!key) return { level: "warn", detail: "API key not collected on the box" };
  const body = await getJson<{ data?: { object?: string; issue?: string }[] }>(`${url}/api/system/health`, {
    headers: { "x-api-key": key },
  });
  const issues = body?.data ?? [];
  if (issues.length) return { level: "warn", detail: issues.map((i) => `${i.object}: ${i.issue}`).join("; ") };
  return { level: "ok", detail: "no health issues" };
}

/** Jellyfin's encoding settings, which a healthy /System/Info will not tell you
 *  about. */
async function jellyfinHwaccel(target: { url: string; key: string }): Promise<Omit<Check, "id" | "label">> {
  if (!target.key) return { level: "warn", detail: "API key not collected on the box" };
  const enc = await getJson<{ HardwareAccelerationType?: string }>(`${target.url}/System/Configuration/encoding`, {
    headers: { authorization: `MediaBrowser Token="${target.key}"` },
    timeoutMs: 10_000,
  });
  const actual = enc?.HardwareAccelerationType ?? "unknown";
  if (actual !== config.jellyfinHwaccel) {
    return { level: "fail", detail: `hardware acceleration is ${actual}, expected ${config.jellyfinHwaccel}` };
  }
  return { level: "ok", detail: `hardware acceleration ${actual}` };
}

async function seerr(): Promise<Omit<Check, "id" | "label">> {
  const status = await getJson<{ version?: string }>(`${config.jellyseerr.url}/api/v1/status`);
  return { level: "ok", detail: `up, ${status?.version ?? "version unknown"}` };
}

/** The torrent VPN. Down on purpose (the kill switch) is a warning; a tunnel that
 *  is gone or leaking the home line is a failure. */
async function vpn(): Promise<Omit<Check, "id" | "label">> {
  if (!vpnConfigured()) return { level: "warn", detail: "gluetun key not collected on the box" };
  const snap = await vpnSnapshot();
  if (snap.killSwitch) return { level: "warn", detail: "tunnel stopped by the kill switch" };
  if (snap.status === "down") return { level: "fail", detail: snap.leak.detail || `tunnel ${snap.tunnel}` };
  if (snap.status === "warn") return { level: "warn", detail: snap.leak.detail || "torrent port not bound to the tunnel" };
  return { level: "ok", detail: `tunnel ${snap.tunnel}${snap.exit ? `, exit ${snap.exit.country}` : ""}` };
}

async function assemble(): Promise<Checks> {
  const seen: CheckContainer[] = [];
  const pending: Promise<Check>[] = [
    run("radarr", "Radarr health", () => arrHealth(config.radarr, "v3")),
    run("sonarr", "Sonarr health", () => arrHealth(config.sonarr, "v3")),
    run("prowlarr", "Prowlarr health", () => arrHealth(config.prowlarr, "v1")),
    run("bazarr", "Bazarr health", bazarrHealth),
    run("seerr", "Seerr", seerr),
    run("jellyfin", "Jellyfin (NAS) transcoding", () => jellyfinHwaccel(config.jellyfin)),
    run("jellyfin-local", "Jellyfin (mini PC) transcoding", () => jellyfinHwaccel(config.jellyfinLocal)),
    run("vpn", "Torrent VPN", vpn),
    run("dns", "DNS ad blocking", dnsCheck),
  ];
  if (dockerConfigured()) pending.unshift(run("containers", "Containers", () => containers(seen)));

  const checks = await Promise.all(pending);
  return { at: new Date().toISOString(), level: worst(checks.map((c) => c.level)), checks, containers: seen };
}

export function checks(): Promise<Checks> {
  return cache.get("checks", assemble);
}

/** What the home page's alert strip shows for the checks, without making the
 *  summary wait for them: the last result is used as it stands and a refresh is
 *  started behind it, so the strip is at most one poll behind. */
export function checkAlerts(): Alert[] {
  void checks().catch(() => undefined);
  const last = cache.stale<Checks>("checks");
  if (!last) return [];
  return last.checks
    .filter((c) => c.level === "fail" || c.level === "warn")
    .map((c) => ({
      name: c.label,
      severity: c.level === "fail" ? "critical" : "warning",
      state: "firing",
      since: last.at,
      summary: c.detail,
    }));
}
