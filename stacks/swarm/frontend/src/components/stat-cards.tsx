import { ArrowDown, ArrowUp, HardDrive } from "lucide-react";
import { splitBytes } from "@/lib/format";
import type { ServerState } from "@/lib/types";

/** A figure at display size with its unit set small beside it. The numerals
 *  carry the page -- there is no decorative face anywhere else. */
function Figure({ value, unit, tone }: { value: string; unit: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`num text-[44px] leading-none font-semibold ${tone ?? ""}`}>{value}</span>
      <span className="num text-base text-muted">{unit}</span>
    </div>
  );
}

function Card({
  icon,
  label,
  children,
  note,
  wide,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  note?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col rounded-2xl bg-surface p-5 ${wide ? "col-span-2" : ""}`}>
      <div className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted">
        {icon}
      </div>
      <div className="mt-6">{children}</div>
      {/* The label belongs to the figure, so it sits directly under it. Anything
       * explanatory goes after, separated by space. */}
      <p className="mt-1.5 text-[13px] text-muted">{label}</p>
      {note ? <div className="mt-4 text-[13px] text-muted">{note}</div> : null}
    </div>
  );
}

export function StatCards({
  server,
  trackedBytes,
  trackedCount,
}: {
  server: Partial<ServerState>;
  trackedBytes: number;
  trackedCount: number;
}) {
  const free = server.free_space_on_disk ?? 0;
  const freeParts = splitBytes(free);
  const tracked = splitBytes(trackedBytes);

  // Below 50 GB the box stops being able to take a 4K release; below 20 GB it
  // is about to fail imports. Say so with colour rather than a warning banner.
  const tone =
    free < 20 * 1024 ** 3 ? "text-danger" : free < 50 * 1024 ** 3 ? "text-amber" : "";

  const down = splitBytes(server.dl_info_speed ?? 0);
  const up = splitBytes(server.up_info_speed ?? 0);

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card
        icon={<HardDrive size={16} />}
        label="free on disk"
        wide
        note={
          <>
            qBittorrent tracks{" "}
            <span className="num text-foreground">
              {trackedCount} {trackedCount === 1 ? "torrent" : "torrents"}
            </span>{" "}
            holding{" "}
            <span className="num text-foreground">
              {tracked.value} {tracked.unit}
            </span>
            . Anything else on disk is invisible to it.
          </>
        }
      >
        <Figure value={freeParts.value} unit={freeParts.unit} tone={tone} />
      </Card>

      <Card icon={<ArrowDown size={16} />} label="download">
        <Figure value={down.value} unit={`${down.unit}/s`} />
      </Card>

      <Card icon={<ArrowUp size={16} />} label="upload">
        <Figure value={up.value} unit={`${up.unit}/s`} />
      </Card>
    </div>
  );
}
