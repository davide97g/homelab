import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { record } from "../actions/audit.js";
import { Cache } from "../cache.js";
import { config } from "../config.js";
import type { DnsSnapshot } from "../wire.js";
import { fritzConfigured, readFritzDns, useProviderDns } from "./fritz.js";
import { probe, type ProbeResult } from "./probe.js";

// The house's DNS fallback. The FRITZ!Box forwards every query to AdGuard on
// this box (apps/adguard). If AdGuard stops answering, nothing in the house
// resolves, so this watches it and, after `afterMs` of silence, points the
// FRITZ!Box back at the provider's DNS.
//
// One way only. Going back to AdGuard needs the FRITZ!Box's own confirmation (a
// button on the box), so it stays a person's job; the card says when it is due.
//
// Two things keep this from firing when it should not:
// - a public resolver is asked first. If that is silent too, the line is down,
//   not AdGuard, and switching would only leave the house unfiltered once the
//   line returns;
// - one attempt per `retryMs`, so a FRITZ!Box that refuses is not hammered.
//
// It covers AdGuard failing while this box is up. When the box itself is down
// the hub is down with it, and the README's phone steps are the fallback.

const fritzCache = new Cache(60_000);

type Bypass = { at: string; reason: string; by: "auto" | "manual" };

let last: (ProbeResult & { at: string }) | null = null;
let failingSince: number | null = null;
let lastAttempt = 0;
let acting = false;
let note: string | null = null;
let bypass: Bypass | null = null;

const statePath = () => join(dirname(config.auditPath), "dns-failover.json");

async function loadState(): Promise<void> {
  try {
    bypass = JSON.parse(await readFile(statePath(), "utf8")) as Bypass | null;
  } catch {
    bypass = null;
  }
}

async function saveState(): Promise<void> {
  try {
    await writeFile(statePath(), JSON.stringify(bypass), "utf8");
  } catch (err) {
    console.error("dns state write failed:", err instanceof Error ? err.message : err);
  }
}

function readFritz() {
  return fritzCache.get("fritz", readFritzDns);
}

/** Shared by the automatic failover and the manual action, so both leave the
 *  same trace: the FRITZ!Box switched, the reason kept, the cache dropped. */
export async function bypassAdguard(reason: string, by: Bypass["by"]): Promise<string> {
  fritzCache.delete("fritz");
  const before = await readFritzDns();
  if (before.mode === "provider") return "the FRITZ!Box was already on the provider's DNS";
  await useProviderDns();
  fritzCache.delete("fritz");
  bypass = { at: new Date().toISOString(), reason, by };
  await saveState();
  return `the FRITZ!Box now uses the provider's DNS (was ${before.servers.join(", ") || "custom"}): ${reason}`;
}

async function failover(): Promise<void> {
  acting = true;
  lastAttempt = Date.now();
  try {
    const line = await probe(config.dns.reference);
    if (!line.ok) {
      note = `AdGuard and ${config.dns.reference} are both silent: the line looks down, so DNS was left alone`;
      return;
    }
    const seconds = Math.round((Date.now() - (failingSince ?? Date.now())) / 1000);
    const reason = `AdGuard ${last?.detail ?? "silent"} for ${seconds} s`;
    const message = await bypassAdguard(reason, "auto");
    note = null;
    await record({ at: new Date().toISOString(), action: "dns.failover", outcome: "ok", message, from: "hub (automatic)" });
  } catch (err) {
    const message = `could not switch the FRITZ!Box: ${err instanceof Error ? err.message : String(err)}`;
    note = message;
    await record({ at: new Date().toISOString(), action: "dns.failover", outcome: "failed", message, from: "hub (automatic)" });
  } finally {
    acting = false;
  }
}

async function tick(): Promise<void> {
  const result = await probe(config.dns.adguardHost);
  last = { ...result, at: new Date().toISOString() };
  if (result.ok) {
    failingSince = null;
    note = null;
    return;
  }
  failingSince ??= Date.now();
  const due = Date.now() - failingSince >= config.dns.afterMs && Date.now() - lastAttempt >= config.dns.retryMs;
  if (due && config.dns.auto && fritzConfigured() && !acting) await failover();
}

export function startDnsWatcher(): void {
  void loadState();
  const run = () => void tick().catch((err) => console.error("dns watcher:", err));
  run();
  setInterval(run, config.dns.probeMs).unref();
}

export async function dnsSnapshot(): Promise<DnsSnapshot> {
  const fritz = fritzConfigured()
    ? await readFritz()
        .then((f) => ({ ...f, error: undefined as string | undefined }))
        .catch((err: unknown) => ({
          mode: "unknown" as const,
          servers: [] as string[],
          error: err instanceof Error ? err.message : String(err),
        }))
    : { mode: "unknown" as const, servers: [] as string[], error: "FRITZ_USER / FRITZ_PASS are not set" };

  // Someone put the FRITZ!Box back on AdGuard (by hand, with the button): the
  // bypass is over, whoever started it.
  if (fritz.mode === "custom" && bypass) {
    bypass = null;
    void saveState();
  }

  const snapshot: DnsSnapshot = {
    auto: config.dns.auto && fritzConfigured(),
    afterSeconds: Math.round(config.dns.afterMs / 1000),
    adguard: {
      ok: last ? last.ok : null,
      detail: last ? `${last.detail} in ${last.ms} ms` : "not probed yet",
      checkedAt: last?.at ?? null,
      failingSince: failingSince ? new Date(failingSince).toISOString() : null,
    },
    fritz: { mode: fritz.mode, servers: fritz.servers },
    bypass: fritz.mode === "provider" ? bypass : null,
    links: { adguard: config.links.adguard, fritz: config.links.fritz },
  };
  if (fritz.error) snapshot.fritz.error = fritz.error;
  if (note) snapshot.note = note;
  return snapshot;
}

/** For /api/checks: is the house filtered, and if not, why. */
export async function dnsCheck(): Promise<{ level: "ok" | "warn" | "fail"; detail: string }> {
  const snap = await dnsSnapshot();
  if (snap.adguard.ok === false) return { level: "fail", detail: `AdGuard is not answering: ${snap.adguard.detail}` };
  if (snap.fritz.mode === "provider") {
    return { level: "warn", detail: "the FRITZ!Box bypasses AdGuard; switch it back in the FRITZ!Box (button needed)" };
  }
  if (snap.fritz.mode === "unknown") return { level: "warn", detail: `FRITZ!Box not readable: ${snap.fritz.error}` };
  return { level: "ok", detail: `AdGuard answering, FRITZ!Box forwarding to ${snap.fritz.servers.join(", ")}` };
}
