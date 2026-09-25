import { useEffect, useState } from "react";
import { preferences, setPreferences, toggleAltSpeed } from "@/lib/qbit";
import type { ServerState } from "@/lib/types";

/* Only the settings that decide whether qBittorrent is a good neighbour on the
 * home connection. Everything else stays the stock UI's business -- this page
 * is deliberately not a mirror of qBittorrent's options dialog. */

const MIB = 1024 * 1024;

type Field = {
  key: string;
  label: string;
  hint: string;
  /** Speed fields are stored in bytes/s and edited in MiB/s. */
  unit?: "MiB/s";
};

const SPEED: Field[] = [
  { key: "dl_limit", label: "Download limit", hint: "0 means no limit.", unit: "MiB/s" },
  { key: "up_limit", label: "Upload limit", hint: "The one that strangles a home line when it saturates.", unit: "MiB/s" },
];

const CONNECTIONS: Field[] = [
  { key: "max_connec", label: "Global connections", hint: "Every connection is an entry in the router's NAT table." },
  { key: "max_connec_per_torrent", label: "Connections per torrent", hint: "" },
  { key: "connection_speed", label: "New connections per second", hint: "The single biggest lever on router load. Stock qBittorrent uses 30." },
  { key: "max_uploads", label: "Upload slots", hint: "" },
  { key: "max_uploads_per_torrent", label: "Upload slots per torrent", hint: "" },
];

export function Settings({ server }: { server: Partial<ServerState> }) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const prefs = await preferences();
      const next: Record<string, number> = {};
      for (const f of [...SPEED, ...CONNECTIONS]) {
        const raw = Number(prefs[f.key] ?? 0);
        next[f.key] = f.unit ? raw / MIB : raw;
      }
      setValues(next);
      setLoaded(true);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, number> = {};
      for (const f of [...SPEED, ...CONNECTIONS]) {
        payload[f.key] = f.unit ? Math.round(values[f.key] * MIB) : Math.round(values[f.key]);
      }
      await setPreferences(payload);
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  function group(title: string, note: string, fields: Field[]) {
    return (
      <section className="rounded-2xl bg-surface p-6">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h2>
        <p className="mt-1 max-w-prose text-[13px] text-muted">{note}</p>
        <div className="mt-5 flex flex-col gap-4">
          {fields.map((f) => (
            <div key={f.key} className="flex items-start gap-6">
              <div className="min-w-0 flex-1">
                <label htmlFor={f.key} className="text-[14px]">
                  {f.label}
                </label>
                {f.hint ? <p className="mt-0.5 text-[13px] text-muted">{f.hint}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  id={f.key}
                  type="number"
                  min={0}
                  step={f.unit ? 0.5 : 1}
                  value={Number.isFinite(values[f.key]) ? values[f.key] : 0}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: Number(e.target.value) }))
                  }
                  className="num w-28 rounded-lg bg-surface-2 px-3 py-2 text-right text-[14px]"
                />
                <span className="w-14 text-[13px] text-muted">{f.unit ?? ""}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!loaded) return <p className="text-[13px] text-muted">Loading settings…</p>;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {group(
        "Speed",
        "Caps apply to everything qBittorrent moves, protocol overhead included.",
        SPEED,
      )}
      {group(
        "Connections",
        "A home router runs out of NAT table entries long before the line runs out of bandwidth. These are the numbers that decide whether the rest of the house keeps working.",
        CONNECTIONS,
      )}

      <section className="flex items-center justify-between gap-6 rounded-2xl bg-surface p-6">
        <div>
          <h2 className="text-[15px] font-medium tracking-[-0.01em]">Alternative limits</h2>
          <p className="mt-1 text-[13px] text-muted">
            The quiet mode, currently{" "}
            <span className={server.use_alt_speed_limits ? "text-accent" : ""}>
              {server.use_alt_speed_limits ? "on" : "off"}
            </span>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => void toggleAltSpeed()}
          className="rounded-lg bg-surface-2 px-4 py-2.5 text-[13px] font-medium hover:bg-surface-3"
        >
          {server.use_alt_speed_limits ? "Switch to normal" : "Switch to quiet"}
        </button>
      </section>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-canvas disabled:opacity-40"
        >
          {saving ? "Saving" : "Save changes"}
        </button>
        {message ? <span className="text-[13px] text-muted">{message}</span> : null}
      </div>
    </div>
  );
}
