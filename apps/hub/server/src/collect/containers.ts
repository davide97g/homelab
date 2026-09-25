import { Cache } from "../cache.js";
import { display } from "../format.js";
import { soft } from "../http.js";
import { byLabel, instant } from "../prom/client.js";
import { dockerConfigured, inspectContainer, listContainers, type DockerContainer } from "../docker/client.js";
import type { ContainerDetail, ContainerHealth, ContainersResponse, ContainerState } from "../wire.js";

// The containers page, from two sources that each know something the other does
// not.
//
//   Docker knows about containers that are not running, which is usually the
//   one you came to look at, and it knows state, health, exit codes and restart
//   counts. It only covers the mini PC: the NAS is not our box and there is no
//   socket there to proxy.
//
//   cAdvisor knows what a container is *doing* -- CPU and RSS -- and covers both
//   machines.
//
// So the list is Docker's, the numbers are cAdvisor's, and the NAS rows come
// from cAdvisor alone and are marked unmanageable, because they are.

const cache = new Cache(4000);

/** Names the actions layer will not touch, whatever the UI asks.
 *
 *  Three groups, and each is here for its own reason. The first is the
 *  infrastructure that would take the box off the internet with it -- stopping
 *  cloudflared from a page served through cloudflared is a locked door with the
 *  key inside. The second is the monitoring stack, which is how you would find
 *  out. The third is this container, which cannot restart itself and answer the
 *  request about it. */
const DENY: { pattern: RegExp; reason: string }[] = [
  { pattern: /^dokploy/, reason: "Dokploy runs the deploys, including this app's" },
  { pattern: /traefik/, reason: "the reverse proxy in front of everything on the box" },
  { pattern: /cloudflared/, reason: "the tunnel this page is reaching you through" },
  { pattern: /^homelab-(prometheus|grafana|loki|alloy|cadvisor|node-exporter)$/, reason: "the monitoring stack this page reads from" },
  { pattern: /^loki/, reason: "the monitoring stack this page reads from" },
  { pattern: /^homelab-hub$/, reason: "this server — it cannot restart itself and answer you" },
];

function denyReason(name: string): string | null {
  return DENY.find((d) => d.pattern.test(name))?.reason ?? null;
}

const STATES: ContainerState[] = ["running", "exited", "created", "paused", "restarting", "removing", "dead"];

function stateOf(raw: string): ContainerState {
  const value = raw.toLowerCase();
  return STATES.find((s) => s === value) ?? "unknown";
}

/** Docker puts health in the status line rather than in a field on the list
 *  endpoint, so "Up 2 hours (healthy)" is where it has to be read from. The
 *  alternative is an inspect per container on every poll. */
function healthOf(status: string): ContainerHealth {
  if (/\(healthy\)/.test(status)) return "healthy";
  if (/\(unhealthy\)/.test(status)) return "unhealthy";
  if (/\(health: starting\)/.test(status)) return "starting";
  return "none";
}

function portsOf(container: DockerContainer): string[] {
  const seen = new Set<string>();
  for (const p of container.Ports ?? []) {
    if (p.PublicPort) seen.add(`${p.PublicPort}→${p.PrivatePort}/${p.Type}`);
  }
  return [...seen].sort();
}

type Metrics = { cpu: Map<string, number>; rss: Map<string, number>; instances: Map<string, string> };

/** cAdvisor's view, keyed by container name. Both machines, running only. */
async function containerMetrics(): Promise<Metrics> {
  const [cpu, rss, seen] = await Promise.all([
    instant(`sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[2m])) * 100`),
    byLabel(`sum by (name) (container_memory_rss{name!=""})`, "name"),
    instant(`container_last_seen{name!=""}`),
  ]);

  const cpuByName = new Map<string, number>();
  for (const row of cpu) {
    const name = row.labels.name;
    if (name) cpuByName.set(name, Number.isFinite(row.value) ? row.value : 0);
  }

  const instances = new Map<string, string>();
  for (const row of seen) {
    const name = row.labels.name;
    if (name && row.labels.instance) instances.set(name, row.labels.instance);
  }

  return { cpu: cpuByName, rss, instances };
}

function fromDocker(c: DockerContainer, metrics: Metrics): ContainerDetail {
  const name = (c.Names?.[0] ?? "").replace(/^\//, "") || c.Id.slice(0, 12);
  const reason = denyReason(name);
  const rssBytes = metrics.rss.get(name) ?? null;
  const project = c.Labels?.["com.docker.compose.project"];
  const service = c.Labels?.["com.docker.compose.service"];

  const row: ContainerDetail = {
    id: c.Id.slice(0, 12),
    name,
    image: c.Image,
    instance: "homelab",
    state: stateOf(c.State),
    status: c.Status,
    health: healthOf(c.Status),
    createdMs: c.Created ? c.Created * 1000 : null,
    restarts: null,
    cpuPercent: metrics.cpu.get(name) ?? null,
    rssBytes,
    rssDisplay: display(rssBytes, "bytes"),
    ports: portsOf(c),
    managed: reason === null,
  };
  if (project && service) row.compose = { project, service };
  if (reason) row.reason = reason;
  return row;
}

/** The NAS's containers, from cAdvisor only. Running ones exist, stopped ones
 *  cannot be known, and none of them can be actioned: userspace tailscaled gives
 *  that box no tailnet egress and it is not ours to put a socket proxy on. */
function fromCadvisor(metrics: Metrics, instance: "homelab" | "nas"): ContainerDetail[] {
  const rows: ContainerDetail[] = [];
  for (const [name, where] of metrics.instances) {
    if (where !== instance) continue;
    const rssBytes = metrics.rss.get(name) ?? null;
    rows.push({
      id: name,
      name,
      image: "—",
      instance,
      state: "running",
      status: "running (cAdvisor)",
      health: "none",
      createdMs: null,
      restarts: null,
      cpuPercent: metrics.cpu.get(name) ?? null,
      rssBytes,
      rssDisplay: display(rssBytes, "bytes"),
      ports: [],
      managed: false,
      reason:
        instance === "nas"
          ? "the NAS is not our box: no Docker API there, and no tailnet egress to reach one"
          : "the Docker socket proxy is not configured",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function assemble(): Promise<ContainersResponse> {
  const metrics = (await soft(containerMetrics())) ?? {
    cpu: new Map<string, number>(),
    rss: new Map<string, number>(),
    instances: new Map<string, string>(),
  };

  const nas = fromCadvisor(metrics, "nas");

  if (!dockerConfigured()) {
    const homelab = fromCadvisor(metrics, "homelab");
    const containers = [...homelab, ...nas];
    return {
      at: new Date().toISOString(),
      source: "cadvisor",
      notice:
        "The Docker socket proxy is not configured, so this list comes from cAdvisor: running containers only, and nothing can be started or stopped.",
      counts: { running: containers.length, stopped: 0, total: containers.length },
      containers,
    };
  }

  const list = await soft(listContainers());
  if (!list) {
    const homelab = fromCadvisor(metrics, "homelab");
    const containers = [...homelab, ...nas];
    return {
      at: new Date().toISOString(),
      source: "cadvisor",
      notice: "The Docker socket proxy did not answer; falling back to what cAdvisor can see.",
      counts: { running: containers.length, stopped: 0, total: containers.length },
      containers,
    };
  }

  const homelab = list.map((c) => fromDocker(c, metrics));

  // Restart counts need an inspect each, so they are read only for containers
  // that are not quietly running -- which is where the number is interesting and
  // is normally two or three of them, not forty.
  const unwell = homelab.filter((c) => c.state !== "running" || c.health === "unhealthy").slice(0, 10);
  await Promise.all(
    unwell.map(async (row) => {
      const detail = await soft(inspectContainer(row.id));
      if (detail) row.restarts = detail.RestartCount;
    }),
  );

  const containers = [...homelab, ...nas].sort((a, b) => {
    // Anything not running floats to the top: that is why the page is open.
    const rank = (c: ContainerDetail) => (c.state === "running" ? (c.health === "unhealthy" ? 1 : 2) : 0);
    return rank(a) - rank(b) || (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0) || a.name.localeCompare(b.name);
  });

  const running = containers.filter((c) => c.state === "running").length;

  return {
    at: new Date().toISOString(),
    source: "docker",
    notice:
      nas.length > 0
        ? "The NAS rows come from cAdvisor: running containers only, and read-only."
        : undefined,
    counts: { running, stopped: containers.length - running, total: containers.length },
    containers,
  };
}

export function containers(): Promise<ContainersResponse> {
  return cache.get("containers", assemble);
}

/** The dispatcher's question: is this a container on the mini PC that the deny
 *  list allows touching? Resolved against the live list rather than a name the
 *  browser sent, so an id cannot be invented. */
export async function resolveManaged(nameOrId: string): Promise<ContainerDetail | { error: string }> {
  const all = await containers();
  const hit = all.containers.find((c) => c.name === nameOrId || c.id === nameOrId);
  if (!hit) return { error: `no container called ${nameOrId}` };
  if (hit.instance !== "homelab") return { error: "that container is on the NAS, which has no Docker API here" };
  if (!hit.managed) return { error: hit.reason ?? "that container is not managed from here" };
  return hit;
}
