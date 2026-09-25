import type { ContainersResponse, MediaPipeline, Summary, Topology } from "@wire";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AtlasCard, AtlasHud, AtlasLedger } from "@/components/atlas/panels";
import {
  buildAtlas,
  isDrawn,
  isListed,
  type AtlasFocus,
  type AtlasLayer,
} from "@/components/atlas/model";
import { AtlasStage } from "@/components/atlas/stage";
import { AlertStrip } from "@/components/cards/alert-strip";
import { Booting } from "@/components/shell/trace";
import { STATUS_TONE } from "@/components/primitives";
import { usePoll } from "@/hooks/use-poll";
import { fetchContainers, fetchMedia, fetchTopology } from "@/lib/api";

// What is running, and on which machine.
//
// Topology keeps the paths. This is the other question the landing page cannot
// answer without turning into a legend: the services of the media pipeline and
// the containers beside them, orbiting the box they actually run on. The
// picture and the list are the same selection, and a token only moves when its
// status is bad or a measurement says it is busy.

function same(a: AtlasFocus, b: AtlasFocus): boolean {
  return a?.kind === b?.kind && a?.id === b?.id;
}

function toneOf(statuses: Array<"up" | "warn" | "down" | "unconfigured">) {
  if (statuses.includes("down")) return STATUS_TONE.down;
  if (statuses.includes("warn")) return STATUS_TONE.warn;
  if (statuses.includes("up")) return STATUS_TONE.up;
  return STATUS_TONE.unconfigured;
}

export function AtlasPage({ data }: { data: Summary }) {
  const loadTopology = useCallback((signal: AbortSignal) => fetchTopology(signal), []);
  const loadMedia = useCallback((signal: AbortSignal) => fetchMedia(signal), []);
  const loadContainers = useCallback((signal: AbortSignal) => fetchContainers(signal), []);
  const { data: topology, error } = usePoll<Topology>(loadTopology, 5000);
  const { data: media, error: mediaError } = usePoll<MediaPipeline>(loadMedia, 8000);
  const { data: containers, error: containersError } = usePoll<ContainersResponse>(loadContainers, 8000);

  const [hovered, setHovered] = useState<AtlasFocus>(null);
  const [selected, setSelected] = useState<AtlasFocus>(null);
  const [layer, setLayer] = useState<AtlasLayer>("all");
  const [query, setQuery] = useState("");
  const focus = selected ?? hovered;

  const select = useCallback((next: Exclude<AtlasFocus, null>) => {
    setSelected((current) => (same(current, next) ? null : next));
  }, []);

  const model = useMemo(
    () => (topology ? buildAtlas(topology, media, containers) : null),
    [topology, media, containers],
  );

  const listed = useMemo(
    () => (model ? model.items.filter((item) => isListed(item, layer, query)) : []),
    [model, layer, query],
  );
  const drawn = useMemo(
    () => (model ? model.items.filter((item) => isDrawn(item, layer, query, model.items)) : []),
    [model, layer, query],
  );

  const focusItem = focus && model ? model.items.find((item) => item.kind === focus.kind && item.id === focus.id) : undefined;

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`atlas-${focus.kind}-${focus.id}`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  if (error && !topology) {
    return <div className="neu text-tone-bad mx-auto mt-6 max-w-lg p-5 text-sm">Could not read the estate: {error}</div>;
  }

  if (!model || !topology) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Booting label="placing devices and what runs on them" />
      </div>
    );
  }

  const hosts = [data.hosts.homelab.status, data.hosts.nas.status];
  const serviceCounts = media
    ? {
        up: media.counts.up,
        total: media.counts.up + media.counts.warn + media.counts.down + media.counts.unconfigured,
        tone: toneOf(
          [
            media.counts.down > 0 ? "down" : null,
            media.counts.warn > 0 ? "warn" : null,
            media.counts.up > 0 ? "up" : null,
          ].filter((s): s is "up" | "warn" | "down" => s !== null),
        ),
      }
    : null;
  const firing = data.alerts.filter((a) => a.state === "firing");
  const sideNote = [model.containerNote, mediaError && `Services did not load: ${mediaError}`, containersError && `Containers did not load: ${containersError}`]
    .filter((line): line is string => Boolean(line))
    .join(" ");

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 pt-1"
      onMouseLeave={() => setHovered(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setSelected(null);
      }}
    >
      <AtlasHud
        machines={{ up: hosts.filter((s) => s === "up").length, total: hosts.length, tone: toneOf(hosts) }}
        services={serviceCounts}
        containers={containers ? { running: containers.counts.running, total: containers.counts.total } : null}
        watts={data.power.wallW === null ? "—" : `${data.power.wallW.toFixed(0)} W`}
        layer={layer}
        onLayer={setLayer}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <AtlasLedger
          items={listed}
          focus={focus}
          query={query}
          onQuery={setQuery}
          note={sideNote || null}
          onFocus={setHovered}
          onSelect={select}
          className="order-2 lg:order-1 lg:max-h-full"
        />

        <div className="relative order-1 aspect-[1.15] sm:aspect-[1.45] lg:order-2 lg:aspect-auto lg:h-full lg:min-h-[460px]">
          <AtlasStage
            items={drawn}
            floors={model.floors}
            bounds={model.bounds}
            focus={focus}
            namedContainers={layer === "containers" || query.trim().length > 0}
            onFocus={setHovered}
            onSelect={select}
            className="absolute inset-0"
          />
          {focusItem && (
            <AtlasCard
              item={focusItem}
              className="animate-in fade-in-0 pointer-events-auto absolute inset-x-0 bottom-0 z-10 max-h-[48%] overflow-y-auto duration-150 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-auto sm:max-h-[72%] sm:w-[280px]"
            />
          )}
        </div>
      </div>

      {firing.length > 0 && (
        <div className="shrink-0">
          <AlertStrip alerts={data.alerts} />
        </div>
      )}
    </div>
  );
}
