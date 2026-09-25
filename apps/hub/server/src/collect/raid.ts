import { instant } from "../prom/client.js";
import type { RaidArray } from "../wire.js";

// md arrays, and the honest reading of them.
//
// node_exporter does not export the RAID *level*, so nothing here says "raid1".
// What it does export is `node_md_disks_required`, and that is the number that
// decides whether the word means anything: an array that requires one member has
// no redundancy however it is labelled, and `node_md_degraded` will read 0 right
// up to the moment that one disk dies.
//
// This box is exactly that case -- four bays, one disk, md1 with
// `disks_required = 1` -- so the page says so in words rather than showing a
// green tick.

/** node_md_state comes back as one series per possible state with a 0/1 value,
 *  rather than one series carrying the state as a value. */
function pickState(rows: { labels: Record<string, string>; value: number }[], device: string): string {
  const hit = rows.find((r) => r.labels.device === device && r.value === 1);
  return hit?.labels.state ?? "unknown";
}

function counts(
  rows: { labels: Record<string, string>; value: number }[],
  device: string,
  state: string,
): number {
  const hit = rows.find((r) => r.labels.device === device && r.labels.state === state);
  return hit ? Math.round(hit.value) : 0;
}

export async function collectArrays(instance: string): Promise<RaidArray[]> {
  const [disks, states, required, degraded, blocks, synced] = await Promise.all([
    instant(`node_md_disks{instance="${instance}"}`),
    instant(`node_md_state{instance="${instance}"}`),
    instant(`node_md_disks_required{instance="${instance}"}`),
    instant(`node_md_degraded{instance="${instance}"}`),
    instant(`node_md_blocks{instance="${instance}"}`),
    instant(`node_md_blocks_synced{instance="${instance}"}`),
  ]);

  const devices = [...new Set(disks.map((r) => r.labels.device).filter((d): d is string => Boolean(d)))].sort();

  return devices.map((device): RaidArray => {
    const active = counts(disks, device, "active");
    const failed = counts(disks, device, "failed");
    const spare = counts(disks, device, "spare");
    const need = Math.round(required.find((r) => r.labels.device === device)?.value ?? 0);
    const isDegraded = (degraded.find((r) => r.labels.device === device)?.value ?? 0) === 1;
    const state = pickState(states, device);

    const total = blocks.find((r) => r.labels.device === device)?.value ?? null;
    const done = synced.find((r) => r.labels.device === device)?.value ?? null;
    const syncFraction =
      total && done !== null && total > 0 && done < total ? Math.max(0, Math.min(1, done / total)) : null;

    const redundancy: RaidArray["redundancy"] = need === 0 ? "unknown" : need === 1 ? "none" : "redundant";

    let note: string;
    if (redundancy === "none") {
      note =
        "One required member, so this array is a single disk. It will keep reporting healthy right up to the moment that disk fails — the array label is not redundancy.";
    } else if (isDegraded || (need > 0 && active < need)) {
      note = `${active} of ${need} members present. The array is running degraded; a second failure loses it.`;
    } else if (syncFraction !== null) {
      note = `${active} of ${need} members present, resyncing (${Math.round(syncFraction * 100)}%).`;
    } else {
      note = `${active} of ${need} members present and in sync.`;
    }

    return { device, state, active, failed, spare, required: need, degraded: isDegraded, redundancy, note, syncFraction };
  });
}
