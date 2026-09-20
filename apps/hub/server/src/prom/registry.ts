import type { Range, SeriesKind, Unit } from "../wire.js";

// Every expression the hub can ask Prometheus for, in one file.
//
// The browser sends an id. It never sends PromQL, and this is the reason:
// accepting a query string would put a query engine behind a single password,
// where one `rate(...[30d])` across 180 days of TSDB can stall Prometheus for
// the whole stack -- including its own alert evaluation, so the thing that would
// have told you is the thing that broke.
//
// It buys three more things beyond safety. Step is clamped server-side, so no
// request can ask for 172 800 points. Unit, title and legend travel with the
// data, so a panel is one component with nothing hard-coded in the browser. And
// responses are cacheable by key, so four open tabs are one upstream query.
//
// The cost is that a new panel is a server deploy. That is why every frame
// carries a Grafana Explore link built from the same expression: the escape
// hatch for an ad-hoc question is one click away, and this registry never has to
// be complete.

export type Instance = "homelab" | "nas";

export type Ctx = {
  instance: Instance;
  rangeS: number;
  stepS: number;
  /** Rate window, already formatted — `max(4 * step, 60s)`. Four steps because a
   *  rate over fewer than two scrapes is noise, and the NAS is scraped at 60 s. */
  window: string;
  /** The machine's busiest real interface, resolved rather than assumed. */
  device: string;
  /** Smoothing window for the temperature band. */
  smooth: string;
};

type ExprDef = {
  expr: (c: Ctx) => string;
  /** `{{label}}` is substituted from the series' labels, as in Grafana. */
  legend: string;
  color?: string;
  area?: boolean;
  dashed?: boolean;
  mirror?: boolean;
};

export type SeriesDef = {
  title: string;
  description?: string;
  unit: Unit;
  kind: SeriesKind;
  /** Floor on the step, so a short range does not ask for sub-scrape resolution. */
  minStepS: number;
  instances: Instance[];
  exprs: ExprDef[];
  domain?: [number | null, number | null];
  /** Empty is a normal answer — a sensor the board does not have, a fan that
   *  does not report. The panel hides instead of showing an error. */
  optional?: boolean;
};

export const RANGE_SECONDS: Record<Range, number> = {
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
  "30d": 2592000,
};

/** The hottest sensor by kernel label, with a fallback for chips the kernel
 *  gives no label — amdgpu, nvme and k10temp have one; the DIMM sensors, the
 *  WiFi chip and the ACPI zone do not, so an inner join silently drops them.
 *  Unlabelled sensors fall back to their *chip*, because both DIMM sensors are
 *  called `temp1` and would otherwise draw two identically named lines. */
export function namedSensors(i: Instance): string {
  const labelled =
    `label_replace(node_hwmon_temp_celsius{instance="${i}"}` +
    ` * on(instance,chip,sensor) group_left(label) node_hwmon_sensor_label{instance="${i}"}` +
    `, "display", "$1", "label", "(.*)")`;
  const unlabelled =
    `label_replace(node_hwmon_temp_celsius{instance="${i}"}` +
    ` unless on(instance,chip,sensor) node_hwmon_sensor_label{instance="${i}"}` +
    `, "display", "$1", "chip", "(.*)")`;
  return `(${labelled} or ${unlabelled}) * on(instance,chip) group_left(chip_name) node_hwmon_chip_names{instance="${i}"}`;
}

/** Filesystem types that are not storage: kernel bookkeeping, a squashfs image,
 *  the desktop session's gvfs mounts. One definition, because the chart and the
 *  occupancy recap disagreeing about what counts as a disk would be worse than
 *  either of them being wrong. */
export const PSEUDO_FS = "tmpfs|overlay|squashfs|ramfs|devtmpfs|fuse.*|nsfs|iso9660|autofs|efivarfs";

export const SERIES: Record<string, SeriesDef> = {
  // ——— Compute ———
  "cpu.total": {
    title: "CPU utilisation",
    unit: "percent",
    kind: "area",
    minStepS: 15,
    instances: ["homelab", "nas"],
    domain: [0, null],
    exprs: [
      {
        expr: (c) => `100 - (avg(rate(node_cpu_seconds_total{instance="${c.instance}",mode="idle"}[${c.window}])) * 100)`,
        legend: "total",
        color: "chart-1",
        area: true,
      },
    ],
  },
  "cpu.percore": {
    title: "Per-thread CPU",
    description: "One row per hardware thread. A single hot thread is a different problem from a busy box.",
    unit: "percent",
    kind: "line",
    minStepS: 15,
    instances: ["homelab", "nas"],
    domain: [0, 100],
    exprs: [
      {
        expr: (c) => `100 - (rate(node_cpu_seconds_total{instance="${c.instance}",mode="idle"}[${c.window}]) * 100)`,
        legend: "cpu{{cpu}}",
      },
    ],
  },
  "cpu.modes": {
    title: "CPU by mode",
    unit: "percent",
    kind: "stack",
    minStepS: 15,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) =>
          `sum by (mode) (rate(node_cpu_seconds_total{instance="${c.instance}",mode!="idle"}[${c.window}]))` +
          ` / on() group_left count(count by (cpu) (node_cpu_seconds_total{instance="${c.instance}"})) * 100`,
        legend: "{{mode}}",
      },
    ],
  },
  load: {
    title: "Load average",
    unit: "ratio",
    kind: "line",
    minStepS: 15,
    instances: ["homelab", "nas"],
    domain: [0, null],
    exprs: [
      { expr: (c) => `node_load1{instance="${c.instance}"}`, legend: "1m", color: "chart-1" },
      { expr: (c) => `node_load5{instance="${c.instance}"}`, legend: "5m", color: "chart-2" },
      { expr: (c) => `node_load15{instance="${c.instance}"}`, legend: "15m", color: "chart-6" },
    ],
  },
  "mem.breakdown": {
    title: "Memory",
    description: "Used excludes cache and buffers, which the kernel will hand back under pressure.",
    unit: "bytes",
    kind: "stack",
    minStepS: 15,
    instances: ["homelab", "nas"],
    domain: [0, null],
    exprs: [
      {
        expr: (c) => `node_memory_MemTotal_bytes{instance="${c.instance}"} - node_memory_MemAvailable_bytes{instance="${c.instance}"}`,
        legend: "used",
        color: "chart-1",
        area: true,
      },
      {
        expr: (c) => `node_memory_Cached_bytes{instance="${c.instance}"} + node_memory_Buffers_bytes{instance="${c.instance}"}`,
        legend: "cache + buffers",
        color: "chart-2",
        area: true,
      },
      {
        expr: (c) => `node_memory_SwapTotal_bytes{instance="${c.instance}"} - node_memory_SwapFree_bytes{instance="${c.instance}"}`,
        legend: "swap",
        color: "chart-5",
        area: true,
      },
    ],
  },

  // ——— Thermals ———
  "temp.sensors": {
    title: "Temperatures",
    description:
      "Every sensor by its kernel label. On the mini PC the WiFi chip often reads hottest and its interface is DOWN, so it tracks case temperature rather than load.",
    unit: "celsius",
    kind: "line",
    minStepS: 15,
    instances: ["homelab", "nas"],
    exprs: [{ expr: (c) => namedSensors(c.instance), legend: "{{chip_name}} {{display}}" }],
  },
  "temp.band": {
    title: "Min / avg / max, smoothed",
    description: "All three rising together means the case is heat-soaking, not that one component is working.",
    unit: "celsius",
    kind: "line",
    minStepS: 30,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) => `max(avg_over_time(node_hwmon_temp_celsius{instance="${c.instance}"}[${c.smooth}]))`,
        legend: "max",
        color: "tone-bad",
      },
      {
        expr: (c) => `avg(avg_over_time(node_hwmon_temp_celsius{instance="${c.instance}"}[${c.smooth}]))`,
        legend: "avg",
        color: "tone-warn",
      },
      {
        expr: (c) => `min(avg_over_time(node_hwmon_temp_celsius{instance="${c.instance}"}[${c.smooth}]))`,
        legend: "min",
        color: "chart-2",
      },
    ],
  },

  // ——— Power ———
  "power.wall": {
    title: "Power draw",
    description:
      "Wall power is measured at the plug. The package rail is averaged, not instantaneous — the live reading bursts well above the sustained draw and reads as impossible next to a plug figure.",
    unit: "watts",
    kind: "area",
    minStepS: 15,
    instances: ["homelab"],
    domain: [0, null],
    exprs: [
      { expr: () => "homelab:power_wall_watts:estimate", legend: "wall", color: "chart-1", area: true },
      { expr: () => "homelab:power_package_watts:avg", legend: "APU package", color: "chart-2" },
    ],
  },
  "power.plug": {
    title: "Plug detail",
    unit: "ratio",
    kind: "line",
    minStepS: 15,
    instances: ["homelab"],
    optional: true,
    exprs: [
      { expr: () => 'tasmota_power_factor_ratio{job="smartplug"}', legend: "power factor", color: "chart-3" },
    ],
  },
  "power.nas": {
    title: "CPU package power",
    description: "RAPL. The NAS is not on a metering plug, so this covers the CPU package and nothing else.",
    unit: "watts",
    kind: "area",
    minStepS: 60,
    instances: ["nas"],
    domain: [0, null],
    exprs: [
      { expr: () => "nas:power_package_watts", legend: "package", color: "chart-1", area: true },
      { expr: () => "nas:power_core_watts", legend: "cores", color: "chart-2" },
    ],
  },
  "energy.daily": {
    title: "Energy per day",
    description: "From the plug's cumulative counter, differenced per day. Gauge-shaped, so this is not increase().",
    unit: "kwh",
    kind: "bar",
    minStepS: 86400,
    instances: ["homelab"],
    domain: [0, null],
    exprs: [
      {
        expr: () => "max_over_time(homelab:energy_total_kwh[1d]) - min_over_time(homelab:energy_total_kwh[1d])",
        legend: "kWh",
        color: "chart-1",
      },
    ],
  },

  // ——— Network ———
  "net.throughput": {
    title: "Throughput",
    description: "Transmit is drawn below the axis, so a symmetric link looks symmetric.",
    unit: "bitsPerSec",
    kind: "area",
    minStepS: 15,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) => `rate(node_network_receive_bytes_total{instance="${c.instance}",device="${c.device}"}[${c.window}]) * 8`,
        legend: "receive",
        color: "chart-2",
        area: true,
      },
      {
        expr: (c) => `rate(node_network_transmit_bytes_total{instance="${c.instance}",device="${c.device}"}[${c.window}]) * 8`,
        legend: "transmit",
        color: "chart-1",
        area: true,
        mirror: true,
      },
    ],
  },
  "net.errors": {
    title: "Errors, drops and flaps",
    description: "Flat at zero is the expected shape. Anything else is a cable, a port or a driver.",
    unit: "count",
    kind: "line",
    minStepS: 15,
    instances: ["homelab", "nas"],
    domain: [0, null],
    exprs: [
      {
        expr: (c) => `rate(node_network_receive_errs_total{instance="${c.instance}",device="${c.device}"}[${c.window}])`,
        legend: "rx errors",
        color: "tone-bad",
      },
      {
        expr: (c) => `rate(node_network_transmit_errs_total{instance="${c.instance}",device="${c.device}"}[${c.window}])`,
        legend: "tx errors",
        color: "chart-7",
      },
      {
        expr: (c) => `rate(node_network_receive_drop_total{instance="${c.instance}",device="${c.device}"}[${c.window}])`,
        legend: "rx drops",
        color: "tone-warn",
      },
      {
        expr: (c) => `changes(node_network_up{instance="${c.instance}",device="${c.device}"}[${c.window}])`,
        legend: "link flaps",
        color: "chart-4",
      },
    ],
  },
  "net.containers": {
    title: "Busiest containers",
    unit: "bitsPerSec",
    kind: "stack",
    minStepS: 30,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) =>
          `topk(8, sum by (name) (rate(container_network_receive_bytes_total{instance="${c.instance}",name!=""}[${c.window}])` +
          ` + rate(container_network_transmit_bytes_total{instance="${c.instance}",name!=""}[${c.window}])) * 8)`,
        legend: "{{name}}",
      },
    ],
  },

  // ——— Storage ———
  "fs.used": {
    title: "Filesystem fill",
    description: "Real filesystems only. The desktop session's gvfs mounts are the kernel's, not the disk's.",
    unit: "percent",
    kind: "line",
    minStepS: 60,
    instances: ["homelab", "nas"],
    domain: [0, 100],
    exprs: [
      {
        expr: (c) =>
          `100 * (1 - node_filesystem_avail_bytes{instance="${c.instance}",fstype!~"${PSEUDO_FS}"}` +
          ` / node_filesystem_size_bytes{instance="${c.instance}",fstype!~"${PSEUDO_FS}"})`,
        legend: "{{mountpoint}}",
      },
    ],
  },
  "disk.io": {
    title: "Disk throughput",
    unit: "bytesPerSec",
    kind: "area",
    minStepS: 15,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) => `sum(rate(node_disk_read_bytes_total{instance="${c.instance}",device=~"nvme.*|sd.*|md.*"}[${c.window}]))`,
        legend: "read",
        color: "chart-2",
        area: true,
      },
      {
        expr: (c) => `sum(rate(node_disk_written_bytes_total{instance="${c.instance}",device=~"nvme.*|sd.*|md.*"}[${c.window}]))`,
        legend: "written",
        color: "chart-1",
        area: true,
        mirror: true,
      },
    ],
  },
  "disk.util": {
    title: "Device utilisation",
    description: "Share of wall time the device had at least one request in flight.",
    unit: "percent",
    kind: "line",
    minStepS: 15,
    instances: ["homelab", "nas"],
    domain: [0, null],
    exprs: [
      {
        expr: (c) => `rate(node_disk_io_time_seconds_total{instance="${c.instance}",device=~"nvme.*|sd.*|md.*"}[${c.window}]) * 100`,
        legend: "{{device}}",
      },
    ],
  },
  "container.cpu": {
    title: "Container CPU",
    unit: "percent",
    kind: "stack",
    minStepS: 30,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) => `topk(10, sum by (name) (rate(container_cpu_usage_seconds_total{instance="${c.instance}",name!=""}[${c.window}])) * 100)`,
        legend: "{{name}}",
      },
    ],
  },
  "container.mem": {
    title: "Container memory",
    description:
      "RSS rather than working set: qBittorrent's page cache makes working set read as multiple gigabytes of 'usage' that is not really used.",
    unit: "bytes",
    kind: "stack",
    minStepS: 30,
    instances: ["homelab", "nas"],
    exprs: [
      {
        expr: (c) => `topk(10, sum by (name) (container_memory_rss{instance="${c.instance}",name!=""}))`,
        legend: "{{name}}",
      },
    ],
  },
  "qbit.rates": {
    title: "qBittorrent",
    description: "Client-wide. Per-torrent series are deliberately not collected — see the monitoring README.",
    unit: "bytesPerSec",
    kind: "area",
    minStepS: 15,
    instances: ["homelab"],
    optional: true,
    exprs: [
      // These are cumulative session counters, not gauges, so they need a rate.
      { expr: (c) => `rate(qbittorrent_dl_info_data_total[${c.window}])`, legend: "download", color: "chart-2", area: true },
      { expr: (c) => `rate(qbittorrent_up_info_data_total[${c.window}])`, legend: "upload", color: "chart-1", area: true, mirror: true },
    ],
  },
};

export type SeriesId = keyof typeof SERIES;
