import { Fragment } from "react";
import { Info, Pause, Play, Trash2 } from "lucide-react";
import { IconButton } from "./icon-button";
import { Progress } from "./progress";
import { TONE_TEXT, describe, isComplete, isStopped } from "@/lib/state";
import { bytes, eta, percent, ratio, speed } from "@/lib/format";
import type { Torrent } from "@/lib/types";

/** A dot-separated fact line. Facts are text, never chips -- chips are for
 *  filters you can click, and a row of pills reads like a form. */
function Facts({ t }: { t: Torrent }) {
  const { tone, label } = describe(t.state);
  const done = isComplete(t);
  const parts = [
    bytes(t.size),
    !done && t.dlspeed > 0 ? `↓ ${speed(t.dlspeed)}` : null,
    !done ? eta(t.eta) : null,
    t.upspeed > 0 ? `↑ ${speed(t.upspeed)}` : null,
    done ? `ratio ${ratio(t.ratio)}` : null,
    t.num_seeds > 0 || t.num_leechs > 0 ? `${t.num_seeds} seeds, ${t.num_leechs} peers` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[tone]}`}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {label}
      </span>
      {parts.map((p) => (
        <Fragment key={p}>
          <span className="text-surface-3" aria-hidden>
            ·
          </span>
          <span className="num">{p}</span>
        </Fragment>
      ))}
    </div>
  );
}

export function TorrentRow({
  t,
  onToggle,
  onDetails,
  onDelete,
}: {
  t: Torrent;
  onToggle: (t: Torrent) => void;
  onDetails: (t: Torrent) => void;
  onDelete: (t: Torrent) => void;
}) {
  const { tone } = describe(t.state);
  const stopped = isStopped(t);

  return (
    <div className="group rounded-xl bg-surface px-5 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium tracking-[-0.01em]" title={t.name}>
            {t.name}
          </h3>
          <div className="mt-1.5">
            <Facts t={t} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 opacity-60 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 focus-within:opacity-100">
          <IconButton
            icon={stopped ? Play : Pause}
            label={stopped ? `Start ${t.name}` : `Stop ${t.name}`}
            onClick={() => onToggle(t)}
          />
          <IconButton icon={Info} label={`Details for ${t.name}`} onClick={() => onDetails(t)} />
          <IconButton icon={Trash2} label={`Delete ${t.name}`} onClick={() => onDelete(t)} danger />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Progress value={t.progress} tone={stopped ? "muted" : tone} />
        <span className="num w-12 shrink-0 text-right text-xs text-muted">
          {percent(t.progress)}
        </span>
      </div>
    </div>
  );
}
