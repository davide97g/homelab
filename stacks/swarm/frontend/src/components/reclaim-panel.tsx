import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "./icon-button";
import { bytes, ratio, since } from "@/lib/format";
import { isComplete } from "@/lib/state";
import type { Torrent } from "@/lib/types";

type Sort = "size" | "ratio" | "idle";

const SORTS: { key: Sort; label: string }[] = [
  { key: "size", label: "biggest" },
  { key: "ratio", label: "best ratio" },
  { key: "idle", label: "longest idle" },
];

/**
 * What to delete first.
 *
 * qBittorrent can only see torrents it still tracks, so this is not a picture
 * of the disk -- it is a picture of what this client can actually free. Only
 * completed torrents appear; deleting an unfinished one loses work.
 */
export function ReclaimPanel({
  torrents,
  onDelete,
}: {
  torrents: Torrent[];
  onDelete: (t: Torrent) => void;
}) {
  const [sort, setSort] = useState<Sort>("size");

  const rows = useMemo(() => {
    const done = torrents.filter(isComplete);
    const sorted = [...done].sort((a, b) => {
      if (sort === "size") return b.size - a.size;
      if (sort === "ratio") return b.ratio - a.ratio;
      return a.last_activity - b.last_activity;
    });
    return sorted.slice(0, 5);
  }, [torrents, sort]);

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]">Reclaimable</h2>
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              className={`rounded-full px-3 py-1 text-xs transition-colors duration-[var(--dur-fast)] ${
                sort === s.key ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-surface px-5 py-6 text-[13px] text-muted">
          Nothing finished is being tracked, so there is nothing here to free. Files already on
          disk that qBittorrent has forgotten do not show up — remove those from the filesystem.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((t) => (
            <div
              key={t.hash}
              className="group flex items-center gap-4 rounded-xl bg-surface px-5 py-3.5
                transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]" title={t.name}>
                  {t.name}
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  <span className="num">{bytes(t.size)}</span>
                  <span className="mx-2 text-surface-3">·</span>
                  <span className="num">ratio {ratio(t.ratio)}</span>
                  <span className="mx-2 text-surface-3">·</span>
                  <span className="num">active {since(t.last_activity)}</span>
                </p>
              </div>
              <div className="opacity-60 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 focus-within:opacity-100">
                <IconButton icon={Trash2} label={`Delete ${t.name}`} onClick={() => onDelete(t)} danger />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
