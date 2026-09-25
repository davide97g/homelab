import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DetailsPanel } from "@/components/details-panel";
import { Login } from "@/components/login";
import { Rail, type View } from "@/components/rail";
import { Dashboard } from "@/pages/dashboard";
import { Settings } from "@/pages/settings";
import { Transfers } from "@/pages/transfers";
import { add, authenticated, remove, start, stop } from "@/lib/qbit";
import { useSync } from "@/lib/use-sync";
import { isStopped } from "@/lib/state";
import { speed } from "@/lib/format";
import type { Torrent } from "@/lib/types";

const VIEWS: View[] = ["dashboard", "transfers", "settings"];

function viewFromHash(): View {
  const raw = window.location.hash.replace("#/", "") as View;
  return VIEWS.includes(raw) ? raw : "dashboard";
}

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Torrent | null>(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    void authenticated().then(setSignedIn);
  }, []);

  const sync = useSync(signedIn === true);

  // The session can expire while the page is open; the poller notices first.
  useEffect(() => {
    if (sync.needsLogin) setSignedIn(false);
  }, [sync.needsLogin]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: View) => {
    window.location.hash = `#/${next}`;
    setView(next);
  }, []);

  const torrents = useMemo(() => Object.values(sync.torrents), [sync.torrents]);
  const selected = details ? sync.torrents[details] : undefined;

  const onToggle = useCallback(
    async (t: Torrent) => {
      await (isStopped(t) ? start([t.hash]) : stop([t.hash]));
      sync.refresh();
    },
    [sync],
  );

  const onConfirmDelete = useCallback(
    async (deleteFiles: boolean) => {
      if (!pendingDelete) return;
      await remove([pendingDelete.hash], deleteFiles);
      setPendingDelete(null);
      if (details === pendingDelete.hash) setDetails(null);
      sync.refresh();
    },
    [pendingDelete, details, sync],
  );

  // Drop a .torrent anywhere. The whole window is the target, so there is no
  // small rectangle to aim at.
  useEffect(() => {
    if (signedIn !== true) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDropping(false);
    };
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.name.endsWith(".torrent"),
      );
      if (files.length) {
        await add({ files });
        sync.refresh();
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [signedIn, sync]);

  if (signedIn === null) return null;
  if (!signedIn) return <Login onSuccess={() => setSignedIn(true)} />;

  return (
    <div className="flex min-h-dvh gap-2 px-5">
      <Rail view={view} onChange={go} />

      <main className="min-w-0 flex-1 py-6 pr-1">
        <header className="mb-8 flex items-center gap-6">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Swarm</h1>

          <div className="relative min-w-0 max-w-md flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value && view !== "transfers") go("transfers");
              }}
              placeholder="Search torrents"
              aria-label="Search torrents"
              className="w-full rounded-full bg-surface py-2 pr-4 pl-9 text-[13px] placeholder:text-muted"
            />
          </div>

          <div className="ml-auto flex items-center gap-5 text-[13px]">
            <span className="num flex items-center gap-1.5 text-muted">
              <ArrowDown size={14} className="text-accent" />
              {speed(sync.server.dl_info_speed ?? 0)}
            </span>
            <span className="num flex items-center gap-1.5 text-muted">
              <ArrowUp size={14} />
              {speed(sync.server.up_info_speed ?? 0)}
            </span>
            <span
              className={`size-2 rounded-full ${sync.connected ? "bg-accent" : "bg-danger"}`}
              title={sync.connected ? "Connected" : "Not reaching qBittorrent"}
              aria-label={sync.connected ? "Connected" : "Not reaching qBittorrent"}
            />
          </div>
        </header>

        {view === "dashboard" ? (
          <Dashboard
            torrents={torrents}
            server={sync.server}
            onToggle={onToggle}
            onDetails={(t) => setDetails(t.hash)}
            onDelete={setPendingDelete}
            onAdded={sync.refresh}
            onSeeAll={() => go("transfers")}
          />
        ) : null}

        {view === "transfers" ? (
          <Transfers
            torrents={torrents}
            categories={sync.categories}
            query={query}
            onToggle={onToggle}
            onDetails={(t) => setDetails(t.hash)}
            onDelete={setPendingDelete}
          />
        ) : null}

        {view === "settings" ? <Settings server={sync.server} /> : null}
      </main>

      {selected ? <DetailsPanel torrent={selected} onClose={() => setDetails(null)} /> : null}

      {pendingDelete ? (
        <ConfirmDelete
          torrent={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(deleteFiles) => void onConfirmDelete(deleteFiles)}
        />
      ) : null}

      {dropping ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[rgb(11_12_14/0.85)]">
          <p className="text-[17px]">Drop to add</p>
        </div>
      ) : null}
    </div>
  );
}
