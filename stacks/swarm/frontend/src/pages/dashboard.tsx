import { AddDrop } from "@/components/add-drop";
import { ReclaimPanel } from "@/components/reclaim-panel";
import { StatCards } from "@/components/stat-cards";
import { TorrentRow } from "@/components/torrent-row";
import { isComplete } from "@/lib/state";
import type { ServerState, Torrent } from "@/lib/types";

export function Dashboard({
  torrents,
  server,
  onToggle,
  onDetails,
  onDelete,
  onAdded,
  onSeeAll,
}: {
  torrents: Torrent[];
  server: Partial<ServerState>;
  onToggle: (t: Torrent) => void;
  onDetails: (t: Torrent) => void;
  onDelete: (t: Torrent) => void;
  onAdded: () => void;
  onSeeAll: () => void;
}) {
  const trackedBytes = torrents.reduce((sum, t) => sum + (t.size ?? 0), 0);
  // Unfinished work first, then whatever moved most recently.
  const recent = [...torrents]
    .sort((a, b) => {
      const ac = isComplete(a) ? 1 : 0;
      const bc = isComplete(b) ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return b.last_activity - a.last_activity;
    })
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-[3fr_1fr] gap-4">
        <StatCards server={server} trackedBytes={trackedBytes} trackedCount={torrents.length} />
        <AddDrop onAdded={onAdded} />
      </div>

      <ReclaimPanel torrents={torrents} onDelete={onDelete} />

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-medium tracking-[-0.01em]">Transfers</h2>
          {torrents.length > recent.length ? (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              See all {torrents.length}
            </button>
          ) : null}
        </header>

        {recent.length === 0 ? (
          <p className="rounded-xl bg-surface px-5 py-6 text-[13px] text-muted">
            No torrents. Sonarr and Radarr add them here automatically, or drop a .torrent file
            anywhere on this page.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map((t) => (
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
      </section>
    </div>
  );
}
