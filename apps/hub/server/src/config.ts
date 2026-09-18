// Every address and secret the hub needs, read once at boot.
//
// The rule inherited from mediarr-dash, and it matters: **no default is ever a
// LAN IP.** The box takes its address from DHCP and a new lease has already
// broken every baked-in address once.
//
// Two host notions, deliberately:
//   BOX        the box as this container reaches it -- `homelab-host` is mapped
//              to host-gateway in the compose file, so published ports stay
//              reachable whatever DHCP hands out today.
//   PUBLIC_BOX the box as a *browser* reaches it. Link targets carry this, so it
//              has to resolve on the viewer's machine, where `homelab-host`
//              never would. The tailnet name works on the LAN and off it.
//
// Prometheus and Loki are the exception: they publish nothing, so they are only
// reachable by container name from inside the monitoring network.

const BOX = process.env.HOMELAB_HOST ?? "homelab-host";
const PUBLIC_BOX = process.env.HOMELAB_PUBLIC_HOST ?? "debian";

function publicUrl(envKey: string, port: number): string {
  return (process.env[envKey] ?? `http://${PUBLIC_BOX}:${port}`).replace(/\/+$/, "");
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: PUBLIC_BOX,
  box: BOX,

  /** Single shared password. Unset means the hub refuses to boot. */
  password: process.env.HUB_PASSWORD ?? "",
  /** Signs the session cookie. Generated at boot if unset, so a restart logs you
   *  out; set it to keep sessions across deploys. Rotating it is logout-everywhere. */
  sessionSecret: process.env.SESSION_SECRET ?? "",
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  /** Set true once this is served over HTTPS through the tunnel. Note the
   *  consequence: a browser will not store a Secure cookie over plain HTTP, so
   *  the LAN address can no longer log in. Verification moves to the box. */
  cookieSecure: process.env.COOKIE_SECURE === "true",

  /** The page polls every 5 s; this keeps N open tabs to one upstream fetch. */
  cacheMs: Number(process.env.CACHE_MS ?? 4000),
  timeoutMs: Number(process.env.TIMEOUT_MS ?? 6000),
  /** Hard ceiling on assembling /api/summary. Past it the last good payload is
   *  served with stale: true rather than letting one slow source hold the page. */
  summaryBudgetMs: Number(process.env.SUMMARY_BUDGET_MS ?? 3000),

  prometheus: (process.env.PROMETHEUS_URL ?? "http://prometheus:9090").replace(/\/+$/, ""),
  loki: (process.env.LOKI_URL ?? "http://loki:3100").replace(/\/+$/, ""),

  /** All-in marginal tariff. The Grafana dashboard's textbox defaults to the
   *  same 0.27 EUR; see monitoring/README.md for the derivation. */
  costPerKwh: Number(process.env.COST_PER_KWH ?? 0.27),

  links: {
    grafana: publicUrl("GRAFANA_PUBLIC_URL", 3001),
    dokploy: publicUrl("DOKPLOY_PUBLIC_URL", 3000),
    mediarr: publicUrl("MEDIARR_PUBLIC_URL", 3002),
    jellyfin: publicUrl("JELLYFIN_PUBLIC_URL", 8096),
    jellyseerr: publicUrl("JELLYSEERR_PUBLIC_URL", 5055),
    // Both of these live on the NAS and are only ever reached by their public
    // hostnames, so there is no port fallback that would work.
    cinema: process.env.CINEMA_PUBLIC_URL ?? "https://cinema.davideghiotto.it",
    immich: process.env.IMMICH_PUBLIC_URL ?? "",
  },
} as const;
