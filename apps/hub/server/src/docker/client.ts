import { config } from "../config.js";
import { getJson, request, ServiceError } from "../http.js";

// The Docker API, always through tecnativa/docker-socket-proxy.
//
// The hub does not mount the socket, and `:ro` would not help if it did: a
// read-only bind applies to the file node, not the protocol. `POST
// /containers/x/stop` works fine through one, and so does `POST
// /containers/create` with `Binds: ["/:/host"]`, which is root on the box. The
// proxy is the layer that still holds when this server has a bug, and it is
// configured with CONTAINERS, INFO, VERSION and POST and nothing else -- no
// images, no volumes, no networks, no exec, no build.

export type DockerContainer = {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels: Record<string, string>;
  Ports: { PrivatePort: number; PublicPort?: number; Type: string }[];
};

export type DockerInspect = {
  Id: string;
  Name: string;
  RestartCount: number;
  State: { Status: string; StartedAt: string; FinishedAt: string; ExitCode: number; Health?: { Status: string } };
};

export function dockerConfigured(): boolean {
  return Boolean(config.docker);
}

function url(path: string): string {
  if (!config.docker) throw new ServiceError("the Docker socket proxy is not configured");
  return `${config.docker}${path}`;
}

/** Every container, running or not. `all=1` is the entire reason this endpoint
 *  exists next to cAdvisor: cAdvisor can only see containers that are running,
 *  so a container that died at 03:00 is invisible to it -- which is exactly the
 *  one you are looking for. */
export function listContainers(): Promise<DockerContainer[]> {
  return getJson<DockerContainer[]>(url("/containers/json?all=1"));
}

export function inspectContainer(id: string): Promise<DockerInspect> {
  return getJson<DockerInspect>(url(`/containers/${encodeURIComponent(id)}/json`));
}

export function dockerVersion(): Promise<{ Version: string; ApiVersion: string }> {
  return getJson<{ Version: string; ApiVersion: string }>(url("/version"));
}

/** start, stop and restart. Nothing else is exposed from this module, so the
 *  dispatcher cannot reach `create`, `exec` or `remove` even by accident --
 *  those are also off at the proxy, but a caller should not have to rely on
 *  something two layers away to be sure. */
export async function containerCommand(id: string, command: "start" | "stop" | "restart"): Promise<void> {
  // Docker's default stop timeout is 10 s; past it the container is killed. 30
  // gives a Postgres or a Jellyfin time to close properly.
  const query = command === "start" ? "" : "?t=30";
  const res = await request(url(`/containers/${encodeURIComponent(id)}/${command}${query}`), {
    method: "POST",
    timeoutMs: 45_000,
    allowStatus: [304],
  });
  // 304 means it was already in the state asked for, which is success for an
  // idempotent verb and is what a retried request will see.
  if (res.status !== 204 && res.status !== 304) {
    throw new ServiceError(`docker answered ${res.status}`, res.status);
  }
}
