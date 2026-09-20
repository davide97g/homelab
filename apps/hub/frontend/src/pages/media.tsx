import type { MediaPipeline, Summary } from "@wire";
import { lazy, Suspense, useCallback, useState } from "react";
import { DetailDrawer } from "@/components/media/detail-drawer";
import { FieldLabel, STATUS_LABEL, StatusDot } from "@/components/primitives";
import { Booting } from "@/components/shell/trace";
import { usePoll } from "@/hooks/use-poll";
import { fetchMedia } from "@/lib/api";

// React Flow and its stylesheet are a page's worth of bundle for a page most
// visits never open, so the canvas is a lazy chunk — the same bargain the
// topology scene makes with three.
const PipelineGraph = lazy(() => import("@/components/media/graph"));

/** The media pipeline: how a request becomes a file with subtitles on it.
 *
 *  This is the page that replaced mediarr-dash. Its shape is that app's, because
 *  that shape was right: one node per service, left to right in the order a
 *  request actually travels, live numbers on every card and the lists behind
 *  them one click away.
 *
 *  Two things are different, and both are the hub's rules rather than taste.
 *  The host is not in `/api/media` — it comes from the summary the shell is
 *  already polling, so one machine has one source of numbers. And an edge
 *  animates only when the *server* says something is moving along it, decided
 *  from the collectors' own figures; mediarr-dash decides that in the browser by
 *  finding a stat by its English label and parsing the digits out of its display
 *  string, which stops working the day a label is reworded. */
export function MediaPage({ data }: { data: Summary }) {
  const load = useCallback((signal: AbortSignal) => fetchMedia(signal), []);
  const { data: media, error } = usePoll<MediaPipeline>(load, 5000);
  const [selected, setSelected] = useState<string | null>(null);

  if (error && !media) {
    return (
      <div className="neu text-tone-bad mx-auto mt-6 max-w-lg p-5 text-sm">Could not read the pipeline: {error}</div>
    );
  }

  if (!media) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Booting label="asking seven services what they are doing" />
      </div>
    );
  }

  const node = media.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pt-1">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FieldLabel>Media pipeline</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          {(["up", "warn", "down", "unconfigured"] as const)
            .filter((status) => media.counts[status] > 0)
            .map((status) => (
              <span key={status} className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <StatusDot status={status} />
                <span className="tnum">{media.counts[status]}</span>
                {STATUS_LABEL[status]}
              </span>
            ))}
        </div>
        {media.stale && (
          <span className="text-tone-warn text-[11px]">
            something missed its budget — these are the last good numbers
          </span>
        )}
      </header>

      {/* Same layout bargain as the topology page: by aspect on a phone, where
          the pipeline is wide and shallow and a tall box only letterboxes it;
          filling the column from lg up. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl">
        <div aria-hidden className="dotfield pointer-events-none absolute inset-0" />

        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Booting label="drawing the pipeline" />
            </div>
          }
        >
          <PipelineGraph data={media} host={data.hosts.homelab} selected={selected} onSelect={setSelected} />
        </Suspense>

        <DetailDrawer node={node} onClose={() => setSelected(null)} />
      </div>

      <ul className="text-muted-foreground grid shrink-0 gap-1 px-1 text-[10.5px] leading-snug">
        {media.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
