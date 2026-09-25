export type Status = "up" | "warn" | "down" | "unconfigured";
export type Tone = "default" | "good" | "warn" | "bad" | "accent";

export type Stat = {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  progress?: number;
};

export type Activity = {
  id: string;
  title: string;
  subtitle?: string;
  progress?: number;
  state?: string;
  tone?: Tone;
  meta?: string;
};

export type Snapshot = {
  id: string;
  name: string;
  role: string;
  link: string;
  status: Status;
  version?: string;
  latencyMs?: number;
  error?: string;
  stats: Stat[];
  flags?: { label: string; on: boolean }[];
  activity?: Activity[];
  activityLabel?: string;
};

export type ContainerLoad = { cpuPercent: number; memBytes: number; memLabel: string };

export type Host = {
  reachable: boolean;
  error?: string;
  name: string;
  link: string;
  cpuPercent: number;
  memPercent: number;
  memUsedLabel: string;
  memTotalLabel: string;
  diskPercent: number;
  diskFreeLabel: string;
  tempC: number;
  watts: number;
  load1: number;
  cores: number;
  rxLabel: string;
  txLabel: string;
  uptimeLabel: string;
  containers: Record<string, ContainerLoad>;
};

export type Edge = { id: string; source: string; target: string; label: string; kind?: "feedback" };

export type Overview = {
  at: string;
  host: Host;
  services: Snapshot[];
  edges: Edge[];
  positions: Record<string, { x: number; y: number }>;
  summary: { up: number; warn: number; down: number; unconfigured: number };
};

export class Unauthorized extends Error {}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Unauthorized("unauthorized");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchOverview(signal?: AbortSignal): Promise<Overview> {
  return json<Overview>(await fetch("/api/overview", { signal, credentials: "same-origin" }));
}

export async function fetchSession(): Promise<boolean> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  const body = await json<{ authenticated: boolean }>(res);
  return body.authenticated;
}

export async function login(password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password }),
  });
  await json<{ ok: true }>(res);
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
}
