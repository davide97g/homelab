import type { Summary } from "@wire";
import { HomePage } from "@/pages/home";
import { MetricsPage } from "@/pages/metrics-page";
import { NasPage } from "@/pages/nas";
import { Placeholder } from "@/pages/placeholder";

/** Route content in one place, so adding a page is one entry here and one in the
 *  rail rather than a hunt through a router tree. */
export const PAGES: { path: string; element: (data: Summary) => React.ReactNode }[] = [
  { path: "/", element: (data) => <HomePage data={data} /> },
  {
    path: "/compute",
    element: () => (
      <MetricsPage
        panels={[
          { id: "cpu.total" },
          { id: "load" },
          { id: "cpu.percore", wide: true, height: 240 },
          { id: "cpu.modes" },
          { id: "mem.breakdown" },
          { id: "temp.sensors", wide: true, height: 240 },
          { id: "temp.band", wide: true },
        ]}
      />
    ),
  },
  {
    path: "/power",
    element: () => (
      <MetricsPage
        panels={[
          { id: "power.wall", wide: true, height: 240 },
          { id: "energy.daily" },
          { id: "power.plug" },
          { id: "power.nas", wide: true },
        ]}
        note="Wall power exists only for the mini PC — it is the machine on the metering plug."
      />
    ),
  },
  {
    path: "/network",
    element: () => (
      <MetricsPage
        panels={[
          { id: "net.throughput", wide: true, height: 240 },
          { id: "net.errors" },
          { id: "net.containers" },
        ]}
      />
    ),
  },
  {
    path: "/storage",
    element: () => (
      <MetricsPage
        panels={[
          { id: "fs.used", wide: true },
          { id: "disk.io" },
          { id: "disk.util" },
          { id: "container.cpu" },
          { id: "container.mem" },
          { id: "qbit.rates", wide: true },
        ]}
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
  { path: "/nas", element: () => <NasPage /> },
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
