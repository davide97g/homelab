import type { Summary } from "@wire";

// Types come from the server's wire.ts through the @wire alias, so there is no
// second copy to keep in step. Only the calls live here.

export class Unauthorized extends Error {
  constructor() {
    super("unauthorized");
    this.name = "Unauthorized";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const same: RequestInit = { credentials: "same-origin" };

export function fetchSummary(signal?: AbortSignal): Promise<Summary> {
  return fetch("/api/summary", { ...same, signal }).then((r) => json<Summary>(r));
}

export function fetchSession(): Promise<{ authenticated: boolean }> {
  return fetch("/api/session", same).then((r) => json<{ authenticated: boolean }>(r));
}

export function login(password: string): Promise<{ ok: true }> {
  return fetch("/api/login", {
    ...same,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }).then((r) => json<{ ok: true }>(r));
}

export function logout(): Promise<{ ok: true }> {
  return fetch("/api/logout", { ...same, method: "POST" }).then((r) => json<{ ok: true }>(r));
}
