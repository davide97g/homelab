import { Cache } from "../cache.js";
import { config } from "../config.js";
import { display } from "../format.js";
import { soft } from "../http.js";
import { byLabel, instant, scalar } from "../prom/client.js";
import { namedSensors } from "../prom/registry.js";
import type { ContainerRow, Filesystem, Health, NasBay, NasDetail, SensorRow } from "../wire.js";
import { collectHost } from "./host.js";
import { collectArrays } from "./raid.js";

// The NAS in full. Everything here is already in Prometheus -- the agents in
// monitoring/nas-agents/ have been shipping it since the logs work -- so this
// file is assembly, not collection.
//
// Two things it is careful about, because both are easy to get wrong in a way
// that looks fine:
//
//   The root filesystem is not the number that matters. `/` on UGOS is a 107 GB
//   overlay that never moves; /volume1 is the pool. The overview card already
//   points at /volume1, and so does this.
//
//   Disk capacity and health per drive genuinely cannot be read. node_exporter
//   exports no size metric for an sd device, and UGOS does not install smartctl,
//   so there is no SMART collector to scrape. A bay therefore shows what it
//   really knows -- that a disk is there, that it is rotational, and what it is
//   doing right now -- and the page says the rest is unavailable rather than
//   printing a hopeful zero.

const cache = new Cache(5000);

const BAY_COUNT = 4;
const RATE_WINDOW = "5m";

/** Physical disks only. `sd*` is a bay; `nvme*` is the system disk soldered to
 *  the board, `md*` is the array on top and `dm-*` is LVM on top of that --
 *  counting any of those as a bay would triple the disk count. */
const BAY_DEVICE = "sd[a-z]+";

const EXCLUDED_FS = "tmpfs|overlay|squashfs|ramfs|devtmpfs|fuse.*|nsfs|iso9660";

function health(value: number | null, warn: number, bad: number): Health {
  if (value === null) return "unknown";
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "ok";
}

function filesystem(
  mountpoint: string,
  device: string,
  fstype: string,
  size: number | null,
  avail: number | null,
): Filesystem {
  const used = size !== null && avail !== null ? size - avail : null;
  const percent = size !== null && avail !== null && size > 0 ? 100 * (1 - avail / size) : null;
  return {
    mountpoint,
    device,
    fstype,
    sizeBytes: size,
    usedBytes: used,
    availBytes: avail,
    percent,
    sizeDisplay: display(size, "bytes"),
    usedDisplay: display(used, "bytes"),
    availDisplay: display(avail, "bytes"),
  };
}

async function collectFilesystems(instance: string): Promise<Filesystem[]> {
  const [sizes, avails] = await Promise.all([
    instant(`node_filesystem_size_bytes{instance="${instance}",fstype!~"${EXCLUDED_FS}"}`),
    instant(`node_filesystem_avail_bytes{instance="${instance}",fstype!~"${EXCLUDED_FS}"}`),
  ]);

  const availByMount = new Map(avails.map((r) => [r.labels.mountpoint ?? "", r.value]));

  return sizes
    .map((r) =>
      filesystem(
        r.labels.mountpoint ?? "?",
        r.labels.device ?? "?",
        r.labels.fstype ?? "?",
        Number.isFinite(r.value) ? r.value : null,
        availByMount.get(r.labels.mountpoint ?? "") ?? null,
      ),
    )
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
}

/** Four bays whatever is plugged in, because an empty bay is the reason the
 *  array has no redundancy and hiding it would hide that. Disks fill bays in
 *  kernel-name order, which is the order the backplane enumerates them. */
async function collectBays(instance: string): Promise<NasBay[]> {
  const [info, reads, writes] = await Promise.all([
    instant(`node_disk_info{instance="${instance}",device=~"${BAY_DEVICE}"}`),
    byLabel(
      `rate(node_disk_read_bytes_total{instance="${instance}",device=~"${BAY_DEVICE}"}[${RATE_WINDOW}])`,
      "device",
    ),
    byLabel(
      `rate(node_disk_written_bytes_total{instance="${instance}",device=~"${BAY_DEVICE}"}[${RATE_WINDOW}])`,
      "device",
    ),
  ]);

  const disks = info
    .map((r) => ({ device: r.labels.device ?? "?", rotational: r.labels.rotational === "1" }))
    .sort((a, b) => a.device.localeCompare(b.device));

  return Array.from({ length: Math.max(BAY_COUNT, disks.length) }, (_, index): NasBay => {
    const disk = disks[index];
    if (!disk) {
      return { index, occupied: false, label: `Bay ${index + 1}`, tempC: null };
    }
    const io = (reads.get(disk.device) ?? 0) + (writes.get(disk.device) ?? 0);
    return {
      index,
      occupied: true,
      device: disk.device,
      rotational: disk.rotational,
      sizeBytes: null,
      sizeDisplay: "—",
      ioBytesPerSec: io,
      ioDisplay: display(io, "bytesPerSec"),
      tempC: null,
      label: `Bay ${index + 1} · ${disk.device}`,
    };
  });
}

async function collectSensors(instance: "homelab" | "nas"): Promise<SensorRow[]> {
  const rows = await instant(namedSensors(instance));
  return rows
    .map((r): SensorRow => {
      const chip = r.labels.chip_name ?? r.labels.chip ?? "?";
      const label = r.labels.display ?? r.labels.sensor ?? "?";
      const tempC = Number.isFinite(r.value) ? r.value : null;
      return {
        key: `${chip}:${label}:${r.labels.sensor ?? ""}`,
        chip,
        label,
        tempC,
        display: display(tempC, "celsius"),
        health: health(tempC, 70, 85),
      };
    })
    .sort((a, b) => (b.tempC ?? -Infinity) - (a.tempC ?? -Infinity));
}

async function collectNasContainers(): Promise<ContainerRow[]> {
  const [cpu, rss] = await Promise.all([
    instant(
      `sum by (name) (rate(container_cpu_usage_seconds_total{instance="nas",name!=""}[${RATE_WINDOW}])) * 100`,
    ),
    byLabel(`sum by (name) (container_memory_rss{instance="nas",name!=""})`, "name"),
  ]);

  return cpu
    .map((row): ContainerRow => {
      const name = row.labels.name ?? "?";
      const rssBytes = rss.get(name) ?? null;
      return {
        name,
        instance: "nas",
        cpuPercent: Number.isFinite(row.value) ? row.value : 0,
        rssBytes,
        rssDisplay: display(rssBytes, "bytes"),
      };
    })
    .sort((a, b) => b.cpuPercent - a.cpuPercent);
}

async function assemble(): Promise<NasDetail> {
  const [host, filesystems, arrays, bays, sensors, containers, uname, packageW] = await Promise.all([
    collectHost("nas"),
    soft(collectFilesystems("nas")),
    soft(collectArrays("nas")),
    soft(collectBays("nas")),
    soft(collectSensors("nas")),
    soft(collectNasContainers()),
    soft(instant(`node_uname_info{instance="nas"}`)),
    soft(scalar(`sum(nas:power_package_watts)`)),
  ]);

  const list = filesystems ?? [];
  // /home and /volume1 are the same ext4 on this box -- UGOS bind-mounts the
  // pool -- so the pool is found by mountpoint rather than by size, or the two
  // would tie and the answer would depend on map ordering.
  const pool = list.find((f) => f.mountpoint === "/volume1") ?? null;

  const notes = [
    "Disk capacity and SMART health per drive are not readable on this machine: node_exporter exports no size metric for an sd device, and UGOS does not install smartctl, so there is no SMART collector to scrape.",
    "The NAS has no metering plug. The power figure is the CPU package rail from RAPL — not the disk, the board or the power brick.",
    "This box is not ours. Its Tailscale runs in userspace, so it has no tailnet egress and its logs reach Loki through the tunnel rather than over the tailnet.",
  ];

  return {
    at: new Date().toISOString(),
    host,
    nodename: uname?.[0]?.labels.nodename ?? null,
    kernel: uname?.[0]?.labels.release ?? null,
    pool,
    filesystems: list,
    arrays: arrays ?? [],
    bays: bays ?? [],
    sensors: sensors ?? [],
    containers: containers ?? [],
    packageW: packageW ?? null,
    links: { cinema: config.links.cinema, immich: config.links.immich },
    notes,
  };
}

export function nasDetail(): Promise<NasDetail> {
  return cache.get("nas", assemble);
}
