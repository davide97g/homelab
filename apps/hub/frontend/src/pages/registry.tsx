import type { Summary } from "@wire";
import { HomePage } from "@/pages/home";
import { Placeholder } from "@/pages/placeholder";

/** Route content in one place, so adding a page is one entry here and one in the
 *  rail rather than a hunt through a router tree. */
export const PAGES: { path: string; element: (data: Summary) => React.ReactNode }[] = [
  { path: "/", element: (data) => <HomePage data={data} /> },
  {
    path: "/compute",
    element: () => (
      <Placeholder
        title="Compute & thermals"
        blurb="CPU total and per-thread, load, memory and swap, and every hwmon sensor by its kernel label rather than temp1."
        phase="Waiting on the series registry and the chart layer."
      />
    ),
  },
  {
    path: "/power",
    element: () => (
      <Placeholder
        title="Power & energy"
        blurb="Wall watts against the APU package rail, kWh per day, the monthly cost, and the plug's volts and power factor."
        phase="Waiting on the series registry and the chart layer."
      />
    ),
  },
  {
    path: "/network",
    element: () => (
      <Placeholder
        title="Network"
        blurb="Throughput with transmit mirrored below the axis, errors, drops and link flaps, and which container is moving the bytes."
        phase="Waiting on the series registry and the chart layer."
      />
    ),
  },
  {
    path: "/storage",
    element: () => (
      <Placeholder
        title="Storage"
        blurb="Filesystem fill, NVMe read and write, device utilisation, and how many days until something is full."
        phase="Waiting on the series registry and the chart layer."
      />
    ),
  },
  {
    path: "/containers",
    element: () => (
      <Placeholder
        title="Containers"
        blurb="Every container on both machines with state, restarts, CPU and memory, and a log tail per container."
        phase="Waiting on the Docker socket proxy, which is what keeps this from making the hub root-equivalent on the box."
      />
    ),
  },
  {
    path: "/logs",
    element: () => (
      <Placeholder
        title="Logs"
        blurb="Loki, filtered by host, container or systemd unit, with a level filter and a live tail. The thing that was missing entirely until this week."
        phase="Loki is running and ingesting; the query proxy and the viewer are next."
      />
    ),
  },
  {
    path: "/media",
    element: () => (
      <Placeholder
        title="Media pipeline"
        blurb="Queue depth, wanted subtitles, active streams and torrent states, plus the write actions. The pipeline graph itself stays where it already works, on mediarr."
        phase="Waiting on the actions layer."
      />
    ),
  },
  {
    path: "/nas",
    element: () => (
      <Placeholder
        title="NAS"
        blurb="The UGREEN box in full: pool fill, the RAID picture as it really is, temperatures, its containers and its logs, with its own 3D model."
        phase="Its metrics are already in Prometheus; the page and the model are next."
      />
    ),
  },
  {
    path: "/actions",
    element: () => (
      <Placeholder
        title="Actions"
        blurb="Container restarts, media pipeline writes, Dokploy redeploys — each behind an allow-list, each written to an audit log."
        phase="Last, deliberately: everything else is read-only and carries no risk."
      />
    ),
  },
];
