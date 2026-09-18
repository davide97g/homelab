import type { Summary } from "@wire";
import { HomePage } from "@/pages/home";
import { MetricsPage } from "@/pages/metrics-page";
import { ActionsPage } from "@/pages/actions";
import { ContainersPage } from "@/pages/containers";
import { LogsPage } from "@/pages/logs";
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
  { path: "/containers", element: () => <ContainersPage /> },
  { path: "/logs", element: () => <LogsPage /> },
  {
    path: "/media",
    element: () => (
      <Placeholder
        title="Media pipeline"
        blurb="Queue depth, wanted subtitles, active streams and torrent states. The pipeline graph itself stays where it already works, on mediarr."
        phase="The write side of this already exists on Actions — searches and torrent control. What is left is the read side, which needs the Jellyfin and Jellyseerr keys collecting on the box."
      />
    ),
  },
  { path: "/nas", element: () => <NasPage /> },
  { path: "/actions", element: () => <ActionsPage /> },
];
