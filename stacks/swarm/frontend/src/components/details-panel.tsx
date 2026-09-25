import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { files as getFiles, peers as getPeers, trackers as getTrackers } from "@/lib/qbit";
import { bytes, duration, percent, ratio, since, speed } from "@/lib/format";
import type { Peer, Torrent, TorrentFile, Tracker } from "@/lib/types";

type Tab = "files" | "trackers" | "peers";
const TABS: { key: Tab; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "trackers", label: "Trackers" },
  { key: "peers", label: "Peers" },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 py-1.5">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="num truncate text-[13px]" title={value}>
        {value}
      </span>
    </div>
  );
}

export function DetailsPanel({ torrent, onClose }: { torrent: Torrent; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Detail is fetched only while the panel is open, so the dashboard's single
  // poll stays the only background traffic.
  useEffect(() => {
    let live = true;
    setError(null);
    const load = async () => {
      try {
        if (tab === "files") setFiles(await getFiles(torrent.hash));
        if (tab === "trackers") setTrackers(await getTrackers(torrent.hash));
        if (tab === "peers") setPeers(await getPeers(torrent.hash));
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Could not load that");
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [tab, torrent.hash]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[rgb(11_12_14/0.6)]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${torrent.name}`}
    >
      <aside
        className="flex h-full w-full max-w-xl flex-col bg-canvas"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-4 border-b border-hairline p-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] leading-snug font-medium tracking-[-0.01em]">
              {torrent.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <X size={16} />
          </button>
        </header>

        <div className="overflow-y-auto p-6">
          <div className="rounded-xl bg-surface px-5 py-3">
            <Row label="Progress" value={percent(torrent.progress)} />
            <Row label="Size" value={bytes(torrent.size)} />
            <Row label="Downloaded" value={bytes(torrent.downloaded)} />
            <Row label="Uploaded" value={bytes(torrent.uploaded)} />
            <Row label="Ratio" value={ratio(torrent.ratio)} />
            <Row label="Seeding for" value={duration(torrent.seeding_time)} />
            <Row label="Last active" value={since(torrent.last_activity)} />
            <Row label="Category" value={torrent.category || "none"} />
            <Row label="Saved to" value={torrent.save_path} />
          </div>

          <nav className="mt-6 flex gap-1" aria-label="Detail sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors duration-[var(--dur-fast)] ${
                  tab === t.key ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="mt-3">
            {error ? <p className="text-[13px] text-danger">{error}</p> : null}

            {tab === "files" ? (
              <ul className="flex flex-col gap-1.5">
                {files.map((f) => (
                  <li key={f.index} className="rounded-lg bg-surface px-4 py-2.5">
                    <p className="truncate text-[13px]" title={f.name}>
                      {f.name}
                    </p>
                    <p className="num mt-0.5 text-xs text-muted">
                      {bytes(f.size)} · {percent(f.progress)}
                    </p>
                  </li>
                ))}
                {files.length === 0 && !error ? (
                  <p className="text-[13px] text-muted">No files reported.</p>
                ) : null}
              </ul>
            ) : null}

            {tab === "trackers" ? (
              <ul className="flex flex-col gap-1.5">
                {trackers.map((tr) => (
                  <li key={tr.url} className="rounded-lg bg-surface px-4 py-2.5">
                    <p className="num truncate text-[13px]" title={tr.url}>
                      {tr.url}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {tr.msg || `${tr.num_seeds} seeds, ${tr.num_peers} peers`}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === "peers" ? (
              <ul className="flex flex-col gap-1.5">
                {peers.map((p) => (
                  <li
                    key={`${p.ip}:${p.port}`}
                    className="flex items-center justify-between gap-4 rounded-lg bg-surface px-4 py-2.5"
                  >
                    <span className="num truncate text-[13px]">{p.ip}</span>
                    <span className="truncate text-xs text-muted">{p.client}</span>
                    <span className="num shrink-0 text-xs text-muted">
                      ↓ {speed(p.dl_speed)} ↑ {speed(p.up_speed)}
                    </span>
                  </li>
                ))}
                {peers.length === 0 && !error ? (
                  <p className="text-[13px] text-muted">Nobody connected right now.</p>
                ) : null}
              </ul>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
