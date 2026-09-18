import { Cache } from "../cache.js";
import { config } from "../config.js";
import { display } from "../format.js";
import { soft } from "../http.js";
import { nasLogPulse } from "../loki/query.js";
import { scalar } from "../prom/client.js";
import type { Alert, Metric, Status, TopoLink, TopoNode, TopoSite, Topology, Unit } from "../wire.js";
import { netDevice } from "./host.js";
import { summary } from "./summary.js";

// The estate, as a graph.
//
// The thing this page exists to show is the asymmetry of the span between the
// two flats. Metrics are *pulled* from the mini PC to the NAS over the tailnet.
// Logs are *pushed* the other way, out to the public internet and back in
// through the Cloudflare tunnel -- because the NAS's tailscaled runs in
// userspace and has no egress at all. Those are two independent paths, and when
// NAS data goes quiet the only question worth asking is which of them broke.
//
// Three rules hold this file honest, and each of them is one line away from
// being lost:
//
//   A link with nothing measuring it carries `rate: null`, never 0. A zero is a
//   measurement. Drawing the absence of one the same way is how a dashboard
//   starts lying, and there is a whole link here -- the NAS's own tunnel to
//   cinema. -- that genuinely nothing in this stack observes.
//
//   The edge node's status is *evidence*, not a metric. cloudflared exports
//   nothing here. What is knowable is whether pushed lines arrived, and that one
//   fact clears Alloy, its egress, the Access service token, the ingress rule
//   and Loki's write path in a single stroke.
//
//   Nothing is exposed by an open port. Both hostnames on this page are
//   published by Cloudflare over a tunnel the machine itself dialled outward,
//   which is why the cloud column is drawn as two separate edges: a reader who
//   cannot see that the NAS is reached *through* Cloudflare will go looking for
//   a forwarded port on Ilario's router that does not exist.
//
//   Every latency on this page is a scrape round trip. There is no blackbox
//   exporter in this estate, so nothing here may be called a ping. It is still
//   the number worth watching: the tailnet hop flips between ~3 ms direct and
//   35-80 ms once it falls back to a DERP relay.
//
// Hosts, alerts and hotspots are taken from `summary()` rather than recomputed.
// That endpoint is already cached and already budget-guarded, so the two pages
// cannot disagree about whether the NAS is up.

const cache = new Cache(config.cacheMs);

/** Ten minutes without a line is the point at which the log path stops being
 *  "quiet" and starts being "unverifiable". It matches NasDown's own 10 m `for`,
 *  which exists because a relay hiccup is not an outage. */
const LOG_SILENCE_MS = 10 * 60_000;

const SITES: TopoSite[] = [
  {
    id: "davide",
    label: "Davide's flat",
    subnet: config.topology.subnet,
    note: "The mini PC and the metering plug. Prometheus, Grafana, Loki and the tunnel all run here.",
  },
  {
    id: "ilario",
    label: "Ilario's flat",
    subnet: config.topology.subnet,
    // This one has cost time before. Both flats really are 192.168.15.0/24.
    note: "The NAS, on someone else's network. The matching subnet is a coincidence, not a route — these are different physical networks and neither can reach the other by LAN address.",
  },
  {
    id: "cloud",
    label: "Cloudflare",
    note:
      "Two separate tunnels, both outbound-dialled, and nothing in this estate has a port open to the internet. " +
      `One fronts ${config.topology.lokiPush} with an Access policy in front of it; the other publishes ` +
      `${config.topology.cinemaHost} from the NAS.`,
  },
];

function metric(id: string, label: string, value: number | null, unit: Unit, hint?: string): Metric {
  const m: Metric = {
    id,
    label,
    value,
    unit,
    display: display(value, unit),
    health: value === null ? "unknown" : "ok",
  };
  if (hint) m.hint = hint;
  return m;
}

/** A measured rate, or null. The caller passes null through deliberately; this
 *  only guards against a NaN reaching the payload as a number.
 *
 *  `text` overrides the formatter for the one quantity the wire has no unit for.
 *  Lines per second is not a `count`, and running it through `display()` rounds
 *  1.19 to "1" and leaves the page to append "lines/s" itself — which is both
 *  wrong ("1 lines/s") and a per-metric branch in the browser, the exact thing
 *  MetricCard exists to avoid. The server says the whole string, as it does for
 *  every other number in this app. */
function rateOf(value: number | null, unit: Unit, text?: (v: number) => string): TopoLink["rate"] {
  if (value === null || !Number.isFinite(value)) return null;
  return { value, unit, display: text ? text(value) : display(value, unit) };
}

/** Which alerts belong to which node.
 *
 *  Every job relabels `instance`, so a plug alert arrives labelled `homelab`
 *  like everything else on that box. Routing it by name puts it where someone
 *  would look for it; everything else goes by instance. */
function alertsFor(id: string, alerts: Alert[]): string[] {
  return alerts
    .filter((a) => {
      const plug = a.name.startsWith("SmartPlug");
      if (id === "plug") return plug;
      if (plug) return false;
      return a.instance === id;
    })
    .map((a) => a.name);
}

export async function collectTopology(): Promise<Topology> {
  const snapshot = await summary();

  const device = await soft(netDevice("homelab"));

  const [plugUp, plugWatts, plugKwh, nasLatency, plugLatency, rx, tx, pulse] = await Promise.all([
    soft(scalar('up{job="smartplug"}')),
    soft(scalar("tasmota_active_power_watts")),
    soft(scalar("tasmota_energy_today_kilowatt_hours")),
    soft(scalar('scrape_duration_seconds{job="node-nas"}')),
    soft(scalar('scrape_duration_seconds{job="smartplug"}')),
    // The box's own wire. The rate window floors on its 15 s scrape interval,
    // the same rule every other panel follows.
    device ? soft(scalar(`rate(node_network_receive_bytes_total{instance="homelab",device="${device}"}[2m])`)) : null,
    device ? soft(scalar(`rate(node_network_transmit_bytes_total{instance="homelab",device="${device}"}[2m])`)) : null,
    soft(nasLogPulse()),
  ]);

  const homelab = snapshot.hosts.homelab;
  const nas = snapshot.hosts.nas;
  const alerts = snapshot.alerts;

  const plugStatus: Status = plugUp === 1 ? "up" : plugUp === null ? "unconfigured" : "down";

  const lastAtMs = pulse?.lastAtMs ?? null;
  const silentMs = lastAtMs === null ? null : Date.now() - lastAtMs;
  const logsArriving = silentMs !== null && silentMs < LOG_SILENCE_MS;

  const nodes: TopoNode[] = [
    {
      id: "homelab",
      label: "mini pc",
      kind: "host",
      site: "davide",
      role: homelab.role,
      addresses: [
        { value: config.topology.boxLan, kind: "lan" },
        { value: config.topology.boxTailnet, kind: "tailnet" },
      ],
      status: homelab.status,
      ...(homelab.error ? { note: homelab.error } : {}),
      metrics: homelab.metrics,
      hotspots: homelab.hotspots,
      alerts: alertsFor("homelab", alerts),
      href: "/overview",
    },
    {
      id: "plug",
      label: "smart plug",
      kind: "plug",
      site: "davide",
      role: "NOUS A1T · Tasmota · 2.4 GHz Wi-Fi",
      addresses: [{ value: config.topology.plugLan, kind: "lan" }],
      status: plugStatus,
      note:
        plugStatus === "up"
          ? "Where the mini PC's wall power actually comes from. Without it that figure is modelled from the APU rail instead."
          : "Not answering, so wall power falls back to the modelled estimate.",
      metrics: [
        metric("plug.watts", "Wall power", plugWatts, "watts", "measured at the plug"),
        metric("plug.today", "Today", plugKwh, "kwh"),
      ],
      alerts: alertsFor("plug", alerts),
      href: "/power",
    },
    {
      id: "fritzbox",
      label: "fritz!box",
      kind: "router",
      site: "davide",
      role: "The flat's router and the box's way out",
      addresses: [{ value: config.topology.routerLan, kind: "lan" }],
      // Not a green dot it cannot justify.
      status: "unconfigured",
      note: "Not monitored. Nothing scrapes it, so this is where it sits on the path and nothing more.",
      metrics: [],
      alerts: [],
    },
    {
      id: "nas",
      label: "nas",
      kind: "nas",
      site: "ilario",
      role: nas.role,
      addresses: [{ value: config.topology.nasTailnet, kind: "tailnet" }],
      status: nas.status,
      ...(nas.error ? { note: nas.error } : {}),
      metrics: nas.metrics,
      hotspots: nas.hotspots,
      alerts: alertsFor("nas", alerts),
      href: "/nas",
    },
    {
      id: "nas-router",
      label: "router",
      kind: "router",
      site: "ilario",
      role: "Ilario's router",
      addresses: [{ value: "not known from here", kind: "none" }],
      status: "unconfigured",
      note: "Not monitored, and not ours. The NAS reaches the internet through it; we never do.",
      metrics: [],
      alerts: [],
    },
    {
      id: "edge",
      label: "cloudflare · logs",
      kind: "edge",
      site: "cloud",
      role: `Tunnel and Access · ${config.topology.lokiPush}`,
      addresses: [{ value: config.topology.lokiPush, kind: "public" }],
      // Evidence, not a metric. See the header.
      status: logsArriving ? "up" : "warn",
      note: logsArriving
        ? "Nothing exports a metric for the tunnel. This is inferred: NAS log lines are arriving, which means Alloy, its egress, the Access token, the ingress rule and Loki's write path are all working."
        : lastAtMs === null
          ? "No NAS log lines in the last hour, so the path cannot be confirmed either way. Nothing exports a metric for the tunnel itself."
          : "NAS log lines have stopped arriving, so the path cannot be confirmed. Nothing exports a metric for the tunnel itself.",
      metrics: [
        metric(
          "edge.silence",
          "Last NAS line",
          silentMs === null ? null : Math.round(silentMs / 1000),
          "seconds",
          lastAtMs === null ? "nothing in the last hour" : "ago",
        ),
      ],
      alerts: [],
    },
    {
      id: "cinema-edge",
      label: "cloudflare · cinema",
      kind: "edge",
      site: "cloud",
      role: `The NAS's own tunnel · ${config.topology.cinemaHost}`,
      addresses: [{ value: config.topology.cinemaHost, kind: "public" }],
      // A second Cloudflare node rather than a second link into the first one.
      // They are two tunnels with two credentials and two failure modes, and one
      // of them is inferred up while the other is not watched at all — a single
      // node could not carry both statuses without picking a lie.
      status: "unconfigured",
      note:
        "Cloudflare answers the hostname, terminates TLS and reaches the NAS back down a tunnel the NAS dialled out. " +
        "Ilario's router forwards nothing, and neither does ours. Nothing in this stack scrapes it.",
      metrics: [],
      alerts: [],
    },
    {
      id: "viewer",
      label: "viewers",
      kind: "viewer",
      site: "cloud",
      role: "Whoever is watching Jellyfin",
      addresses: [{ value: "the public internet", kind: "none" }],
      status: "unconfigured",
      note: `Every request lands on Cloudflare's edge. Nobody outside ever addresses the NAS, only ${config.topology.cinemaHost}.`,
      metrics: [],
      alerts: [],
    },
  ];

  const links: TopoLink[] = [
    {
      id: "pull-nas",
      from: "homelab",
      to: "nas",
      transport: "tailnet",
      carries: "metrics, pulled over Tailscale",
      status: nas.status === "down" ? "down" : "up",
      // One scrape is one discrete transfer, not a stream, so the scene fires a
      // single bead per interval rather than a flow. Watching it is watching
      // Prometheus scrape.
      rate: null,
      cadenceS: 60,
      latencyMs: nasLatency === null ? null : Math.round(nasLatency * 1000),
      note: "Prometheus reaches the NAS's exporters on their loopback, which works because the NAS's userspace tailscaled proxies inbound traffic to 127.0.0.1. Scraped once a minute, sized for the hop being relayed rather than direct.",
    },
    {
      id: "pull-plug",
      from: "homelab",
      to: "plug",
      transport: "wifi",
      carries: "one JSON poll, pulled",
      status: plugStatus === "up" ? "up" : plugStatus,
      rate: null,
      cadenceS: 15,
      latencyMs: plugLatency === null ? null : Math.round(plugLatency * 1000),
      note: "json-exporter asks Tasmota for Status 10 and turns the reply into watts. Four times as often as the NAS, which is what the two bead rates are showing you.",
    },
    {
      id: "push-logs",
      from: "nas",
      to: "homelab",
      via: "edge",
      transport: "tunnel",
      carries: "logs, pushed",
      status: logsArriving ? "up" : "warn",
      rate: rateOf(pulse?.linesPerSec ?? null, "count", (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} lines/s`),
      latencyMs: null,
      note: "The NAS cannot reach the tailnet outward at all — its tailscaled is userspace, so the host has no tailscale0 — and its sshd refuses port forwarding. So Alloy pushes out to the public internet and back in through the tunnel, authenticated by a service token that can append to Loki and cannot read from it.",
    },
    {
      id: "lan-uplink",
      from: "homelab",
      to: "fritzbox",
      transport: "lan",
      carries: "everything the box moves",
      status: device ? (homelab.status === "down" ? "down" : "up") : "unconfigured",
      rate: rateOf(rx === null && tx === null ? null : (rx ?? 0) + (tx ?? 0), "bytesPerSec"),
      latencyMs: null,
      note: device
        ? `The box's real wire (${device}, resolved rather than hard-coded). This is total throughput, so the two pulls above are inside it.`
        : "No interface has moved a byte in an hour and none reports a negotiated speed, so there is nothing to measure.",
    },
    {
      id: "cinema",
      from: "nas",
      to: "cinema-edge",
      // Bent through Ilario's router because that is the uplink it leaves by,
      // and drawn as one curve because it is one tunnel: cloudflared on the NAS
      // dials Cloudflare and holds the connection open. There is no second hop
      // that can fail on its own.
      via: "nas-router",
      transport: "tunnel",
      carries: `${config.topology.cinemaHost}, published`,
      status: "unconfigured",
      // The one path on this page that is genuinely unmeasured, drawn as such.
      rate: null,
      latencyMs: null,
      note: "Jellyfin on the NAS, published by the NAS's own Cloudflare tunnel over Ilario's uplink. It never touches the mini PC, so nothing in this stack sees it — not measured, rather than idle.",
    },
    {
      id: "cinema-public",
      from: "viewer",
      to: "cinema-edge",
      transport: "internet",
      carries: "playback requests, inbound",
      status: "unconfigured",
      rate: null,
      latencyMs: null,
      note: `A viewer resolves ${config.topology.cinemaHost} to Cloudflare and talks only to Cloudflare. The arrow stops there because that is where the public internet stops: the rest of the way in is the tunnel above.`,
    },
  ];

  return {
    at: new Date().toISOString(),
    stale: snapshot.stale,
    sites: SITES,
    nodes,
    links,
  };
}

export function topology(): Promise<Topology> {
  return cache.get("topology", collectTopology);
}
