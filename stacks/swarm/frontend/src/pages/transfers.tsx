import { useMemo, useState } from "react";
import { TorrentRow } from "@/components/torrent-row";
import { isBroken, isComplete, isDownloading, isStopped } from "@/lib/state";
import type { Category, Torrent } from "@/lib/types";

type Filter = "all" | "downloading" | "seeding" | "stopped" | "broken";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "downloading", label: "Downloading" },
  { key: "seeding", label: "Seeding" },
  { key: "stopped", label: "Stopped" },
  { key: "broken", label: "Problems" },
];

function matches(t: Torrent, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "downloading") return isDownloading(t);
  if (filter === "seeding") return isComplete(t) && !isStopped(t) && !isBroken(t);
  if (filter === "stopped") return isStopped(t);
  return isBroken(t);
}

export function Transfers({
  torrents,
  categories,
  query,
  onToggle,
  onDetails,
  onDelete,
}: {
  torrents: Torrent[];
  categories: Record<string, Category>;
  query: string;
  onToggle: (t: Torrent) => void;
  onDetails: (t: Torrent) => void;
  onDelete: (t: Torrent) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<string>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return torrents
      .filter((t) => matches(t, filter))
      .filter((t) => category === "all" || t.category === category)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .sort((a, b) => b.last_activity - a.last_activity);
  }, [torrents, filter, category, query]);

  const names = ["all", ...Object.keys(categories)];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors duration-[var(--dur-fast)] ${
                filter === f.key ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {names.length > 1 ? (
          <div className="flex gap-1">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setCategory(name)}
                aria-pressed={category === name}
                className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors duration-[var(--dur-fast)] ${
                  category === name
                    ? "bg-surface-2 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        <span className="num ml-auto text-[13px] text-muted">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-surface px-5 py-6 text-[13px] text-muted">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((t) => (
            <TorrentRow
              key={t.hash}
              t={t}
              onToggle={onToggle}
              onDetails={onDetails}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
