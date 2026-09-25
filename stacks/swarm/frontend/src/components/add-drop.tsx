import { useRef, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { add } from "@/lib/qbit";

/** Drag a .torrent anywhere on the page, or paste a magnet here. */
export function AddDrop({ onAdded }: { onAdded: () => void }) {
  const [magnet, setMagnet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit(files?: File[], urls?: string) {
    setBusy(true);
    setError(null);
    try {
      await add({ files, urls });
      setMagnet("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-surface p-5">
      <div className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted">
        <FilePlus2 size={16} />
      </div>
      <p className="mt-6 text-[15px] font-medium">Add a torrent</p>
      <p className="mt-1 text-[13px] text-muted">Drop a .torrent file anywhere, or paste a magnet.</p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (magnet.trim()) void submit(undefined, magnet.trim());
        }}
      >
        <input
          value={magnet}
          onChange={(e) => setMagnet(e.target.value)}
          placeholder="magnet:?xt=..."
          aria-label="Magnet link"
          className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px] placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !magnet.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-canvas
            transition-opacity duration-[var(--dur-fast)] disabled:opacity-30"
        >
          {busy ? "Adding" : "Add"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => input.current?.click()}
        className="mt-2 text-[13px] text-muted underline-offset-4 hover:text-foreground hover:underline"
      >
        or browse for a file
      </button>
      <input
        ref={input}
        type="file"
        accept=".torrent"
        multiple
        hidden
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          if (chosen.length) void submit(chosen);
          e.target.value = "";
        }}
      />

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
