import { useEffect, useState } from "react";
import type { Torrent } from "@/lib/types";
import { bytes } from "@/lib/format";

/**
 * Deleting files is irreversible, so the two outcomes are separate buttons with
 * different words. There is no checkbox to mis-read, and the destructive one is
 * the one you have to reach for.
 */
export function ConfirmDelete({
  torrent,
  onCancel,
  onConfirm,
}: {
  torrent: Torrent;
  onCancel: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function run(deleteFiles: boolean) {
    setBusy(true);
    onConfirm(deleteFiles);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(11_12_14/0.82)] p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Delete torrent"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-medium tracking-[-0.01em]">Delete this torrent?</h2>
        <p className="mt-2 truncate text-[14px] text-muted" title={torrent.name}>
          {torrent.name}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          <span className="num">{bytes(torrent.size)}</span> on disk.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(false)}
            className="rounded-lg bg-surface-2 px-4 py-2.5 text-[13px] font-medium
              transition-colors duration-[var(--dur-fast)] hover:bg-surface-3 disabled:opacity-40"
          >
            Remove, keep the files
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(true)}
            className="rounded-lg bg-danger px-4 py-2.5 text-[13px] font-medium text-foreground
              transition-opacity duration-[var(--dur-fast)] hover:opacity-90 disabled:opacity-40"
          >
            Delete the files too
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded-lg px-4 py-2.5 text-[13px] text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
