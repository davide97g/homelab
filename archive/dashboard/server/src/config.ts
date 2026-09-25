// Every address and key the dashboard needs, read once at boot.
//
// Defaults point at the box's published ports rather than container names:
// those work whether this runs in Docker, on the box, or on a laptop, and they
// sidestep qBittorrent's Host-header validation, which rejects a request whose
// Host is a container name.
//
// No default is a LAN IP. The box takes its address from DHCP, and a new lease
// used to break every probe here at once.
//
// Prometheus and cAdvisor are the exception -- they are not published, so they
// are only reachable by container name from inside the monitoring network.

// The box as this container reaches it. `homelab-host` is mapped to
// `host-gateway` in the compose file, so the published ports stay reachable
// whatever LAN address DHCP hands the box today. Outside Docker that name does
// not resolve, so set HOMELAB_HOST when running the server on a laptop.
const BOX = process.env.HOMELAB_HOST ?? "homelab-host";

// The box as a browser reaches it. Node links and the header carry this, so it
// must resolve on the viewer's machine -- `homelab-host` never would. The
// tailnet name works on the LAN and away from it, and survives a new lease.
const PUBLIC_BOX = process.env.HOMELAB_PUBLIC_HOST ?? "debian";

function url(envKey: string, port: number): string {
  return (process.env[envKey] ?? `http://${BOX}:${port}`).replace(/\/+$/, "");
}

/** Where the browser should send the user when a node is clicked. Falls back to
 *  the public host rather than the internal one, which the viewer cannot reach. */
function publicUrl(envKey: string, port: number): string {
  return (process.env[envKey] ?? `http://${PUBLIC_BOX}:${port}`).replace(/\/+$/, "");
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: PUBLIC_BOX,

  /** Single shared password. No password set means the dashboard refuses to boot. */
  password: process.env.DASHBOARD_PASSWORD ?? "",
  /** Signs the session cookie. Generated at boot if unset, which logs everyone
   *  out on restart -- fine for a single user, set it to keep sessions. */
  sessionSecret: process.env.SESSION_SECRET ?? "",
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  /** Set true once this is served over HTTPS through the tunnel. */
  cookieSecure: process.env.COOKIE_SECURE === "true",

  /** How long a service snapshot is reused before it is fetched again. */
  cacheMs: Number(process.env.CACHE_MS ?? 4000),
  /** Per-service request budget. A dead service must not stall the whole page. */
  timeoutMs: Number(process.env.TIMEOUT_MS ?? 6000),

  services: {
    jellyseerr: {
      api: url("JELLYSEERR_URL", 5055),
      link: publicUrl("JELLYSEERR_PUBLIC_URL", 5055),
      key: process.env.JELLYSEERR_API_KEY ?? "",
    },
    radarr: {
      api: url("RADARR_URL", 7878),
      link: publicUrl("RADARR_PUBLIC_URL", 7878),
      key: process.env.RADARR_API_KEY ?? "",
    },
    sonarr: {
      api: url("SONARR_URL", 8989),
      link: publicUrl("SONARR_PUBLIC_URL", 8989),
      key: process.env.SONARR_API_KEY ?? "",
    },
    prowlarr: {
      api: url("PROWLARR_URL", 9696),
      link: publicUrl("PROWLARR_PUBLIC_URL", 9696),
      key: process.env.PROWLARR_API_KEY ?? "",
    },
    bazarr: {
      api: url("BAZARR_URL", 6767),
      link: publicUrl("BAZARR_PUBLIC_URL", 6767),
      key: process.env.BAZARR_API_KEY ?? "",
    },
    qbittorrent: {
      api: url("QBITTORRENT_URL", 8080),
      link: publicUrl("QBITTORRENT_PUBLIC_URL", 8080),
      user: process.env.QBITTORRENT_USER ?? "",
      pass: process.env.QBITTORRENT_PASS ?? "",
    },
    jellyfin: {
      api: url("JELLYFIN_URL", 8096),
      link: publicUrl("JELLYFIN_PUBLIC_URL", 8096),
      key: process.env.JELLYFIN_API_KEY ?? "",
    },
  },

  prometheus: {
    api: (process.env.PROMETHEUS_URL ?? "http://prometheus:9090").replace(/\/+$/, ""),
    link: (process.env.GRAFANA_PUBLIC_URL ?? `http://${PUBLIC_BOX}:3001`).replace(/\/+$/, ""),
  },
} as const;

export type Config = typeof config;
