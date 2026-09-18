import { Cache } from "../cache.js";
import { config } from "../config.js";
import { display } from "../format.js";
import { soft } from "../http.js";
import { alerts as promAlerts, scalar } from "../prom/client.js";
import type { Alert, ContainerSummary, HostSummary, PowerSummary, Summary } from "../wire.js";
import { collectContainers, collectHost, HOSTS } from "./host.js";

const cache = new Cache(config.cacheMs);

function unreachable(id: "homelab" | "nas", error: string): HostSummary {
  return {
    id,
    name: HOSTS[id].name,
    role: HOSTS[id].role,
    status: "down",
    error,
    uptimeS: null,
    metrics: [],
    hotspots: {},
  };
}

async function collectPower(): Promise<PowerSummary> {
  // Wall power exists only for the mini PC: it is the machine on the metering
  // plug. The NAS has RAPL and nothing else, which covers the CPU package and
  // not the disk, the board or the brick.
  // The package figure is the *averaged* rail, not the instantaneous one.
  // node_hwmon_power_watt is a live PPT reading that bursts far above the
  // sustained draw -- over one hour it averaged 15.5 W against a 20.3 W wall
  // reading but peaked at 42.1 W, so a single sample regularly lands above the
  // plug's number and reads as impossible. The plug averages; this should too.
  const [wall, pkg, perDay, plugUp] = await Promise.all([
    scalar("homelab:power_wall_watts:estimate"),
    scalar("homelab:power_package_watts:avg"),
    scalar("avg_over_time(homelab:power_wall_watts:estimate[24h]) * 24 / 1000"),
    scalar('up{job="smartplug"}'),
  ]);

  // The tariff is applied here, in JavaScript, and never interpolated into
  // PromQL -- which keeps the one user-supplied number out of every query string.
  const eurPerMonth = perDay === null ? null : perDay * 30 * config.costPerKwh;

  return {
    wallW: wall,
    packageW: pkg,
    kwhPerDay: perDay,
    eurPerMonth,
    source: plugUp === 1 ? "plug" : "model",
    costPerKwh: config.costPerKwh,
  };
}

async function collectAlerts(): Promise<Alert[]> {
  const data = await promAlerts();
  const rows = data?.alerts ?? [];
  return rows
    .map((a): Alert => {
      const severity = a.labels.severity;
      const alert: Alert = {
        name: a.labels.alertname ?? "?",
        severity: severity === "critical" ? "critical" : severity === "warning" ? "warning" : "none",
        state: a.state === "pending" ? "pending" : "firing",
        since: a.activeAt,
        summary: a.annotations.summary ?? "",
      };
      if (a.labels.instance) alert.instance = a.labels.instance;
      return alert;
    })
    .sort((a, b) => {
      const rank = (x: Alert) => (x.state === "firing" ? 0 : 1) * 2 + (x.severity === "critical" ? 0 : 1);
      return rank(a) - rank(b);
    });
}

function emptyContainers(): ContainerSummary {
  return { total: 0, byInstance: { homelab: 0, nas: 0 }, top: [] };
}

/** One payload for the home page.
 *
 *  Three sources fan out here, so the whole thing runs against a hard budget:
 *  past it the last good payload is served with `stale: true`. mediarr-dash gets
 *  away without this because its page has one source-set; here a NAS that has
 *  gone quiet over a relayed tailnet hop would otherwise hold the mini PC's
 *  numbers hostage. */
async function assemble(): Promise<Summary> {
  const [homelab, nas, power, alertList, containers] = await Promise.all([
    soft(collectHost("homelab")),
    soft(collectHost("nas")),
    soft(collectPower()),
    soft(collectAlerts()),
    soft(collectContainers()),
  ]);

  const containerSummary: ContainerSummary = containers
    ? {
        total: containers.counts.homelab + containers.counts.nas,
        byInstance: containers.counts,
        top: containers.top.map((row) => ({
          name: row.name,
          instance: row.instance,
          cpuPercent: row.cpuPercent,
          rssBytes: row.rssBytes,
          rssDisplay: display(row.rssBytes, "bytes"),
        })),
      }
    : emptyContainers();

  return {
    at: new Date().toISOString(),
    stale: false,
    hosts: {
      homelab: homelab ?? unreachable("homelab", "Prometheus did not answer"),
      nas: nas ?? unreachable("nas", "Prometheus did not answer"),
    },
    power:
      power ?? {
        wallW: null,
        packageW: null,
        kwhPerDay: null,
        eurPerMonth: null,
        source: "model",
        costPerKwh: config.costPerKwh,
      },
    alerts: alertList ?? [],
    containers: containerSummary,
    links: config.links,
  };
}

export async function summary(): Promise<Summary> {
  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), config.summaryBudgetMs));
  const fresh = cache.get("summary", assemble);

  const won = await Promise.race([fresh, budget]);
  if (won) return won;

  // Over budget. Serve whatever was last complete and say so; the in-flight
  // fetch is not cancelled, so the next poll will usually be fresh again.
  const last = cache.stale<Summary>("summary");
  if (last) return { ...last, stale: true };
  return fresh;
}
