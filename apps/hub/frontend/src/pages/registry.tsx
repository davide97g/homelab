import type { Summary } from "@wire";
import { HomePage } from "@/pages/home";
import { AtlasPage } from "@/pages/atlas";
import { TopologyPage } from "@/pages/topology";
import { MetricsPage } from "@/pages/metrics-page";
import { ActionsPage } from "@/pages/actions";
import { AskPage } from "@/pages/ask";
import { ContainersPage } from "@/pages/containers";
import { LogsPage } from "@/pages/logs";
import { MediaPage } from "@/pages/media";
import { NasPage } from "@/pages/nas";
import { StoragePage } from "@/pages/storage";

/** Route content in one place, so adding a page is one entry here and one in the
 *  sidebar rather than a hunt through a router tree. */
export const PAGES: { path: string; element: (data: Summary) => React.ReactNode }[] = [
  // The landing page is the estate. The machine view it replaced is still here
  // one route down, which keeps the change reversible and costs one rail entry.
  { path: "/", element: (data) => <TopologyPage data={data} /> },
  // A second reading of the same estate: services and containers on the machines,
  // rather than the paths between them. Topology stays the landing page.
  { path: "/atlas", element: (data) => <AtlasPage data={data} /> },
  { path: "/overview", element: (data) => <HomePage data={data} /> },
  {
    path: "/compute",
    element: (data) => (
      <MetricsPage
        data={data}
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
    element: (data) => (
      <MetricsPage
        data={data}
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
    element: (data) => (
      <MetricsPage
        data={data}
        panels={[
          { id: "net.throughput", wide: true, height: 240 },
          { id: "net.errors" },
          { id: "net.containers" },
        ]}
      />
    ),
  },
  // The only metric page that is not just a panel list: capacity is an instant
  // question and no time series on it could answer "how much room is left".
  { path: "/storage", element: (data) => <StoragePage data={data} /> },
  { path: "/containers", element: () => <ContainersPage /> },
  { path: "/logs", element: () => <LogsPage /> },
  // The summary is passed in because the host card inside the graph is drawn
  // from it: the box carries the pipeline, and its numbers have one source.
  { path: "/media", element: (data) => <MediaPage data={data} /> },
  { path: "/nas", element: () => <NasPage /> },
  { path: "/actions", element: () => <ActionsPage /> },
  // Answers someone kept. The composer that produces them is in the shell.
  { path: "/ask", element: () => <AskPage /> },
];
