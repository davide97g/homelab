import { getJson } from "../http.js";
import { bytes, duration, rate } from "./types.js";

type QueryResult = {
  status: string;
  data?: { resultType: string; result: { metric: Record<string, string>; value: [number, string] }[] };
};

/** The container names cAdvisor reports, mapped onto our node ids, so each
 *  service card can show what it is actually costing the box. */
const CONTAINER_BY_NODE: Record<string, string> = {
  jellyseerr: "jellyseerr",
  radarr: "radarr",
  sonarr: "sonarr",
  prowlarr: "prowlarr",
  bazarr: "bazarr",
  qbittorrent: "qbittorrent",
  jellyfin: "jellyfin",
};

export type ContainerLoad = { cpuPercent: number; memBytes: number; memLabel: string };

export type HostMetrics = {
  reachable: boolean;
  error?: string;
  cpuPercent: number;
  memPercent: number;
  memUsedLabel: string;
  memTotalLabel: string;
  diskPercent: number;
  diskFreeLabel: string;
  tempC: number;
  watts: number;
  load1: number;
  cores: number;
  rxLabel: string;
  txLabel: string;
  uptimeLabel: string;
  containers: Record<string, ContainerLoad>;
};

async function scalar(base: string, query: string): Promise<number> {
  const res = await getJson<QueryResult>(`${base}/api/v1/query?query=${encodeURIComponent(query)}`);
  const raw = res.data?.result?.[0]?.value?.[1];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function byLabel(base: string, query: string, label: string): Promise<Map<string, number>> {
  const res = await getJson<QueryResult>(`${base}/api/v1/query?query=${encodeURIComponent(query)}`);
  const out = new Map<string, number>();
  for (const row of res.data?.result ?? []) {
    const k = row.metric[label];
    const v = Number(row.value[1]);
    if (k && Number.isFinite(v)) out.set(k, v);
  }
  return out;
}

/** Everything the host card needs, in one round of queries.
 *
 *  The power number is the recording rule from the monitoring stack -- a model
 *  built on the amdgpu PPT rail plus a fixed platform offset, not a wall
 *  measurement. Labelled "est." in the UI for that reason. */
export async function collectHost(base: string): Promise<HostMetrics> {
  const empty: HostMetrics = {
    reachable: false,
    cpuPercent: 0, memPercent: 0, memUsedLabel: "-", memTotalLabel: "-",
    diskPercent: 0, diskFreeLabel: "-", tempC: 0, watts: 0, load1: 0, cores: 0,
    rxLabel: "-", txLabel: "-", uptimeLabel: "-", containers: {},
  };

  try {
    const [
      cpu, memTotal, memAvail, diskSize, diskAvail, temp, watts, load1, cores, rx, tx, uptime,
      cpuByName, memByName,
    ] = await Promise.all([
      scalar(base, `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)`),
      scalar(base, `node_memory_MemTotal_bytes`),
      scalar(base, `node_memory_MemAvailable_bytes`),
      scalar(base, `node_filesystem_size_bytes{mountpoint="/"}`),
      scalar(base, `node_filesystem_avail_bytes{mountpoint="/"}`),
      scalar(base, `max(node_hwmon_temp_celsius * on(chip) group_left(chip_name) node_hwmon_chip_names{chip_name="k10temp"})`),
      scalar(base, `homelab:power_wall_watts:estimate`),
      scalar(base, `node_load1`),
      scalar(base, `count(count by (cpu) (node_cpu_seconds_total))`),
      scalar(base, `rate(node_network_receive_bytes_total{device="eno1"}[2m])`),
      scalar(base, `rate(node_network_transmit_bytes_total{device="eno1"}[2m])`),
      scalar(base, `time() - node_boot_time_seconds`),
      byLabel(base, `sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[2m])) * 100`, "name"),
      byLabel(base, `sum by (name) (container_memory_working_set_bytes{name!=""})`, "name"),
    ]);

    const containers: Record<string, ContainerLoad> = {};
    for (const [node, container] of Object.entries(CONTAINER_BY_NODE)) {
      const mem = memByName.get(container) ?? 0;
      containers[node] = {
        cpuPercent: cpuByName.get(container) ?? 0,
        memBytes: mem,
        memLabel: mem ? bytes(mem) : "-",
      };
    }

    const memUsed = memTotal - memAvail;
    return {
      reachable: true,
      cpuPercent: Math.max(0, Math.min(100, cpu)),
      memPercent: memTotal ? (memUsed / memTotal) * 100 : 0,
      memUsedLabel: bytes(memUsed),
      memTotalLabel: bytes(memTotal),
      diskPercent: diskSize ? ((diskSize - diskAvail) / diskSize) * 100 : 0,
      diskFreeLabel: bytes(diskAvail),
      tempC: temp,
      watts,
      load1,
      cores,
      rxLabel: rate(rx),
      txLabel: rate(tx),
      uptimeLabel: duration(uptime),
      containers,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}
