import type { Summary, Topology } from "@wire";
import { useCallback, useState } from "react";
import { AlertStrip } from "@/components/cards/alert-strip";
import { Booting } from "@/components/shell/trace";
import { TopologyMap } from "@/components/topology/map";
import { DetailCard, Ledger, Legend, type Focus } from "@/components/topology/panels";
import { usePoll } from "@/hooks/use-poll";
import { fetchTopology } from "@/lib/api";

/** The landing page: the estate, not a machine.
 *
 *  The hub used to open on the mini PC, which answered "how is this box doing"
 *  and could not answer the question actually asked of it — the homelab is two
 *  flats, six devices and three separate paths between them, and when NAS data
 *  goes quiet the only thing worth knowing is which path broke.
 *
 *  The thesis of the picture is the asymmetry of that span. Metrics are *pulled*
 *  west to east over the tailnet, once a minute; logs are *pushed* the other way
 *  out through the public internet and back in through the Cloudflare tunnel,
 *  because the NAS's userspace tailscaled has no egress at all. The two are
 *  independent, and the page is built so you can watch each of them happen.
 *
 *  Which is also the rule that keeps it honest: **nothing moves unless something
 *  measures it.** A pulled link fires one bead per scrape interval because that
 *  is one discrete transfer; a pushed link flows at its real line rate; and the
 *  NAS's own tunnel out to cinema. sits perfectly still, because nothing in this
 *  stack observes it and a gentle idle shimmer there would be a lie. */
export function TopologyPage({ data }: { data: Summary }) {
  const load = useCallback((signal: AbortSignal) => fetchTopology(signal), []);
  const { data: topology, error } = usePoll<Topology>(load, 5000);

  // Hover and keyboard focus are the same gesture here, and a click pins it —
  // which on a touch screen is the only one of the three available.
  const [focus, setFocus] = useState<Focus>(null);

  if (error && !topology) {
    return (
      <div className="neu text-tone-bad mx-auto mt-6 max-w-lg p-5 text-sm">Could not read the topology: {error}</div>
    );
  }

  if (!topology) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Booting label="tracing the paths between the flats" />
      </div>
    );
  }

  const firing = data.alerts.filter((a) => a.state === "firing");

  return (
    // A column that owns the height it was given, so the picture can take
    // whatever the legend and the alert rail do not. On a tall window the
    // scene was drawing into a 500 px band with a third of the page empty
    // underneath it.
    <div className="flex h-full min-h-0 flex-col gap-4 pt-1">
      <div
        className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"
        // Leaving the picture clears the card rather than leaving the last thing
        // you touched pinned to the corner claiming to be current.
        onMouseLeave={() => setFocus(null)}
      >
        <Ledger
          topology={topology}
          focus={focus}
          onFocus={setFocus}
          className="order-2 lg:order-1 lg:sticky lg:top-2 lg:self-start"
        />

        {/* Below lg the drawing sets its own height by aspect — the estate is
            wide and shallow, and a tall box on a phone just letterboxes it.
            From lg up it fills the column instead. */}
        <div className="relative order-1 aspect-[1.6] lg:order-2 lg:aspect-auto lg:h-full lg:min-h-[420px]">
          <TopologyMap topology={topology} focus={focus} onFocus={setFocus} className="absolute inset-0" />

          {/* Anchored to the corner rather than to the pointer: a card that
              follows the cursor covers the thing you are pointing at. */}
          <DetailCard
            topology={topology}
            focus={focus}
            className="animate-in fade-in-0 pointer-events-auto absolute right-0 bottom-0 duration-150"
          />
        </div>
      </div>

      <Legend className="shrink-0 px-1" />

      {/* Only when there is something to say. Read-only: there is no
          Alertmanager on the box, so an acknowledge button here would have state
          that lived in one browser and looked like the alert was handled. */}
      {firing.length > 0 && (
        <div className="shrink-0">
          <AlertStrip alerts={data.alerts} />
        </div>
      )}
    </div>
  );
}
