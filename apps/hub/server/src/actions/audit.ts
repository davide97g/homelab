import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config.js";
import type { AuditEntry } from "../wire.js";

// Append-only JSONL, one line per *attempt*, including the ones that were
// refused.
//
// Refusals are the interesting half. "Nothing happened" and "something tried to
// happen and was stopped" look identical from the outside, and only one of them
// is worth knowing about at three in the morning. A log of successes is a
// changelog; a log of attempts is an audit.
//
// It lives on a named volume rather than in the source tree, because deploy.py
// clears the directories it owns on every sync and an audit log a deploy erases
// is a log of the last five minutes.

let ready: Promise<void> | null = null;

function ensureDir(): Promise<void> {
  ready ??= mkdir(dirname(config.auditPath), { recursive: true }).then(() => undefined);
  return ready;
}

/** Never throws. An audit that can fail a request would make arranging for it to
 *  fail the safest thing an attacker could do. */
export async function record(entry: AuditEntry): Promise<void> {
  try {
    await ensureDir();
    await appendFile(config.auditPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    console.error("audit write failed:", err instanceof Error ? err.message : err);
  }
}

const TAIL_BYTES = 256 * 1024;

/** The last `limit` entries, newest first. Only the tail of the file is read:
 *  this grows forever by design, and nothing here should get slower because it
 *  has been running for a year. */
export async function tail(limit = 200): Promise<AuditEntry[]> {
  let handle;
  try {
    const info = await stat(config.auditPath);
    handle = await open(config.auditPath, "r");
    const length = Math.min(TAIL_BYTES, info.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, info.size - length);

    const text = buffer.toString("utf8");
    // Drop the partial first line when the file is longer than the window.
    const lines = text.split("\n").slice(info.size > length ? 1 : 0);

    const entries: AuditEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // A torn line at the boundary. Skip it rather than failing the read.
      }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
}
