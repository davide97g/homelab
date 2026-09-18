import { Cache } from "../cache.js";
import { display } from "../format.js";
import { byLabel, instant, scalar } from "../prom/client.js";
import type { Health, HostSummary, Metric, Unit } from "../wire.js";
import { miniPcHotspots, nasHotspots } from "./hotspots.js";

/** Both machines are described by the same shape, and everything that differs
 *  between them lives here rather than in an `if (id === "nas")` further down.
 *
 *  The rate window differs because the scrape intervals do: the mini PC is
 *  scraped every 15 s, the NAS every 60 s over a tailnet hop, and a 2 m window
 *  on a 60 s series is two samples, which is not a rate worth printing. */
type HostSpec = {
  id: "homelab" | "nas";
  name: string;
  role: string;
  job: string;
  rateWindow: string;
  /** The filesystem the card should report. Not "/" on the NAS -- its root is a
   *  107 G overlay that never moves, while the pool is the number that matters. */
  mount: string;
  mountLabel: string;
};

export const HOSTS: Record<"homelab" | "nas", HostSpec> = {
  homelab: {
    id: "homelab",
    name: "homelab",
    role: "GMKtec M6 Ultra · Ryzen 5 7640HS · 40 GB",
    job: "node",
    rateWindow: "2m",
    mount: "/",
    mountLabel: "root",
  },
  nas: {
    id: "nas",
    name: "nas",
    role: "UGREEN DXP4800 Pro · i3-1315U · 8 GB · via tailnet",
    job: "node-nas",
    rateWindow: "5m",
    mount: "/volume1",
    mountLabel: "/volume1",
  },
};

/** Interface names are not stable across machines and must not be hard-coded:
 *  the box is `enp3s0`, the NAS is `eth0`, and mediarr-dash still asks about
 *  `eno1`, which has no cable — its throughput has read zero since the day it
 *  was written. So pick the busiest real interface over the last hour and cache
 *  the answer, since it changes when hardware does and not before. */
const deviceCache = new Cache(600_000);

const EXCLUDE = "lo|veth.*|docker.*|br-.*|tailscale.*|wl.*|ieee80211.*|zt.*";

export async function netDevice(instance: string): Promise<string | null> {
  return deviceCache.get(`net:${instance}`, async () => {
    const busiest = await instant(
      `topk(1, rate(node_network_receive_bytes_total{instance="${instance}",device!~"${EXCLUDE}"}[1h]))`,
    );
    const fromTraffic = busiest[0]?.labels.device;
    if (fromTraffic) return fromTraffic;
    // A machine that has moved no bytes in an hour still has a link; fall back to
    // whichever interface reports a negotiated speed.
    const up = await instant(
      `topk(1, node_network_speed_bytes{instance="${instance}",device!~"${EXCLUDE}"})`,
    );
    return up[0]?.labels.device ?? null;
  });
}

function health(value: number | null, warn: number, bad: number): Health {
  if (value === null) return "unknown";
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "ok";
}

function metric(
  id: string,
  label: string,
  value: number | null,
  unit: Unit,
  opts: { health?: Health; fraction?: number; hint?: string } = {},
): Metric {
  const m: Metric = {
    id,
    label,
    value,
    unit,
    display: display(value, unit),
    health: opts.health ?? (value === null ? "unknown" : "ok"),
  };
  if (opts.fraction !== undefined && Number.isFinite(opts.fraction)) {
    m.fraction = Math.max(0, Math.min(1, opts.fraction));
  }
  if (opts.hint) m.hint = opts.hint;
  return m;
}

/** The hottest sensor, by its kernel label rather than `temp1`.
 *
 *  The join has a fallback half because node_hwmon_sensor_label only exists for
 *  some chips: amdgpu, nvme and k10temp have it, the DIMM sensors, the WiFi chip
 *  and the ACPI zone do not. An inner join would silently drop them. Unlabelled
 *  sensors fall back to their chip, because both DIMM sensors are called temp1
 *  and would otherwise be indistinguishable. */
function hottestExpr(instance: string): string {
  const labelled =
    `label_replace(node_hwmon_temp_celsius{instance="${instance}"}` +
    ` * on(instance,chip,sensor) group_left(label) node_hwmon_sensor_label{instance="${instance}"}` +
    `, "display", "$1", "label", "(.*)")`;
  const unlabelled =
    `label_replace(node_hwmon_temp_celsius{instance="${instance}"}` +
    ` unless on(instance,chip,sensor) node_hwmon_sensor_label{instance="${instance}"}` +
    `, "display", "$1", "chip", "(.*)")`;
  return (
    `topk(1, (${labelled} or ${unlabelled})` +
    ` * on(instance,chip) group_left(chip_name) node_hwmon_chip_names{instance="${instance}"})`
  );
}

export async function collectHost(id: "homelab" | "nas"): Promise<HostSummary> {
  const spec = HOSTS[id];
  const i = spec.id;
  const w = spec.rateWindow;

  const reachable = await scalar(`up{job="${spec.job}"}`);
  if (reachable !== 1) {
    return {
      id,
      name: spec.name,
      role: spec.role,
      status: "down",
      error:
        id === "nas"
          ? "no answer over the tailnet — the hop is relayed and the box is not ours"
          : "node_exporter is not answering",
      uptimeS: null,
      metrics: [],
      hotspots: {},
    };
  }

  const device = await netDevice(i);

  const [
    cpu,
    memTotal,
    memAvail,
    swapTotal,
    swapFree,
    fsSize,
    fsAvail,
    hottest,
    load1,
    cores,
    uptime,
    rx,
    tx,
    diskRead,
    diskWrite,
  ] = await Promise.all([
    scalar(`100 - (avg(rate(node_cpu_seconds_total{instance="${i}",mode="idle"}[${w}])) * 100)`),
    scalar(`node_memory_MemTotal_bytes{instance="${i}"}`),
    scalar(`node_memory_MemAvailable_bytes{instance="${i}"}`),
    scalar(`node_memory_SwapTotal_bytes{instance="${i}"}`),
    scalar(`node_memory_SwapFree_bytes{instance="${i}"}`),
    scalar(`node_filesystem_size_bytes{instance="${i}",mountpoint="${spec.mount}"}`),
    scalar(`node_filesystem_avail_bytes{instance="${i}",mountpoint="${spec.mount}"}`),
    instant(hottestExpr(i)),
    scalar(`node_load1{instance="${i}"}`),
    scalar(`count(count by (cpu) (node_cpu_seconds_total{instance="${i}"}))`),
    scalar(`time() - node_boot_time_seconds{instance="${i}"}`),
    device ? scalar(`rate(node_network_receive_bytes_total{instance="${i}",device="${device}"}[${w}])`) : null,
    device ? scalar(`rate(node_network_transmit_bytes_total{instance="${i}",device="${device}"}[${w}])`) : null,
    scalar(`sum(rate(node_disk_read_bytes_total{instance="${i}",device=~"nvme.*|sd.*"}[${w}]))`),
    scalar(`sum(rate(node_disk_written_bytes_total{instance="${i}",device=~"nvme.*|sd.*"}[${w}]))`),
  ]);

  const cpuPercent = cpu === null ? null : Math.max(0, Math.min(100, cpu));
  const memPercent =
    memTotal && memAvail !== null && memTotal > 0 ? 100 * (1 - memAvail / memTotal) : null;
  const fsPercent = fsSize && fsAvail !== null && fsSize > 0 ? 100 * (1 - fsAvail / fsSize) : null;
  const swapUsed =
    swapTotal !== null && swapFree !== null && swapTotal > 0 ? swapTotal - swapFree : null;

  const top = hottest[0];
  const tempC = top && Number.isFinite(top.value) ? top.value : null;
  const tempName = top
    ? [top.labels.chip_name, top.labels.display].filter(Boolean).join(" ")
    : undefined;

  // The same thresholds the Grafana panels use, so the two never disagree about
  // what counts as hot or full.
  const metrics: Metric[] = [
    metric("cpu.total", "CPU", cpuPercent, "percent", {
      health: health(cpuPercent, 50, 85),
      fraction: cpuPercent === null ? undefined : cpuPercent / 100,
      hint: cores === null ? undefined : `${cores} threads · load ${load1?.toFixed(2) ?? "—"}`,
    }),
    metric("mem.percent", "Memory", memPercent, "percent", {
      health: health(memPercent, 75, 90),
      fraction: memPercent === null ? undefined : memPercent / 100,
      hint:
        memTotal === null
          ? undefined
          : `${display(memTotal - (memAvail ?? 0), "bytes")} of ${display(memTotal, "bytes")}`,
    }),
    metric("temp.hottest", "Temperature", tempC, "celsius", {
      health: health(tempC, 70, 85),
      fraction: tempC === null ? undefined : Math.max(0, (tempC - 30) / 60),
      hint: tempName,
    }),
    metric("fs.percent", spec.mountLabel, fsPercent, "percent", {
      health: health(fsPercent, 80, 90),
      fraction: fsPercent === null ? undefined : fsPercent / 100,
      hint: fsAvail === null ? undefined : `${display(fsAvail, "bytes")} free`,
    }),
    metric("net.throughput", "Network", rx === null && tx === null ? null : (rx ?? 0) + (tx ?? 0), "bytesPerSec", {
      hint: device
        ? `${device} · ${display(rx, "bytesPerSec")} in / ${display(tx, "bytesPerSec")} out`
        : "no active interface",
    }),
    metric("disk.io", "Disk", diskRead === null && diskWrite === null ? null : (diskRead ?? 0) + (diskWrite ?? 0), "bytesPerSec", {
      hint: `${display(diskRead, "bytesPerSec")} read / ${display(diskWrite, "bytesPerSec")} written`,
    }),
    metric("uptime", "Uptime", uptime, "seconds"),
  ];

  if (swapUsed !== null && swapUsed > 0) {
    metrics.push(
      metric("mem.swap", "Swap", swapUsed, "bytes", {
        hint: swapTotal === null ? undefined : `of ${display(swapTotal, "bytes")}`,
      }),
    );
  }

  const worst = metrics.reduce<Health>((acc, m) => {
    if (m.health === "bad") return "bad";
    if (m.health === "warn" && acc !== "bad") return "warn";
    return acc;
  }, "ok");

  const hotspots =
    id === "homelab"
      ? miniPcHotspots({ cpuPercent, tempC, rx, tx, diskRead, diskWrite, load1, cores })
      : nasHotspots({ cpuPercent, tempC, rx, tx, fsPercent, raid: null });

  return {
    id,
    name: spec.name,
    role: spec.role,
    status: worst === "bad" ? "warn" : "up",
    uptimeS: uptime,
    metrics,
    hotspots,
  };
}

/** Running containers, from cAdvisor rather than the Docker API, so this needs
 *  no socket and covers both machines. The cost is that it can only see running
 *  containers: state, health and restart counts are Docker's to tell, and arrive
 *  with the actions layer. */
export async function collectContainers(): Promise<{
  counts: { homelab: number; nas: number };
  top: { name: string; instance: "homelab" | "nas"; cpuPercent: number; rssBytes: number | null }[];
}> {
  const [counts, cpu, rss] = await Promise.all([
    instant(`count by (instance) (container_last_seen{name!=""})`),
    instant(`topk(6, sum by (name, instance) (rate(container_cpu_usage_seconds_total{name!=""}[2m])) * 100)`),
    byLabel(`sum by (name) (container_memory_rss{name!=""})`, "name"),
  ]);

  const byInstance = { homelab: 0, nas: 0 };
  for (const row of counts) {
    const key = row.labels.instance;
    if (key === "homelab" || key === "nas") byInstance[key] = Math.round(row.value);
  }

  const top = cpu
    .map((row) => ({
      name: row.labels.name ?? "?",
      instance: (row.labels.instance === "nas" ? "nas" : "homelab") as "homelab" | "nas",
      cpuPercent: Number.isFinite(row.value) ? row.value : 0,
      rssBytes: rss.get(row.labels.name ?? "") ?? null,
    }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent);

  return { counts: byInstance, top };
}
