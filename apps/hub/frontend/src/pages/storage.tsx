import type { StorageSummary, Summary } from "@wire";
import { useCallback } from "react";
import { FieldLabel } from "@/components/primitives";
import { StorageRecap } from "@/components/storage/recap";
import { usePoll } from "@/hooks/use-poll";
import { fetchStorage } from "@/lib/api";
import { MetricsPage } from "@/pages/metrics-page";

/** Storage: how much room there is, then how it got there.
 *
 *  The recap on top is instant values on their own endpoint rather than more
 *  panels, because capacity is not a time series question — "77%" is what a
 *  chart can say, and "1.2 TB free, filling at 20 GB a day" is what you opened
 *  the page for. The charts below are unchanged and still answer the other half:
 *  which day the fill happened, and what the disks were doing at the time. */
export function StoragePage({ data }: { data: Summary }) {
  const load = useCallback((signal: AbortSignal) => fetchStorage(signal), []);
  const { data: storage, error } = usePoll<StorageSummary>(load, 15000);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <FieldLabel>Space</FieldLabel>
        {storage ? (
          <StorageRecap data={storage} />
        ) : error ? (
          <div className="neu text-tone-bad p-4 text-sm">Could not read capacity: {error}</div>
        ) : (
          <div className="neu text-muted-foreground p-4 text-sm">Reading filesystems…</div>
        )}
      </section>

      <section className="space-y-2">
        <FieldLabel>Over time</FieldLabel>
        <MetricsPage
          data={data}
          panels={[
            { id: "fs.used", wide: true },
            { id: "disk.io" },
            { id: "disk.util" },
            { id: "container.cpu" },
            { id: "container.mem" },
            { id: "qbit.rates", wide: true },
          ]}
        />
      </section>
    </div>
  );
}
