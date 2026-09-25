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
const CINEMA_PUBLIC_URL = process.env.CINEMA_PUBLIC_URL ?? "https://cinema.davideghiotto.it";
const MANGA_PUBLIC_URL = process.env.MANGA_PUBLIC_URL ?? "https://manga.davideghiotto.it";

function publicUrl(envKey: string, port: number): string {
  return (process.env[envKey] ?? `http://${PUBLIC_BOX}:${port}`).replace(/\/+$/, "");
}

/** The same thing for a service **this process** calls rather than links to.
 *  The distinction is the whole reason there are two host notions: a link has to
 *  resolve in a browser on someone's laptop, and a fetch has to resolve inside
 *  this container, where `debian` may not. */
function boxUrl(envKey: string, port: number): string {
  return (process.env[envKey] ?? `http://${BOX}:${port}`).replace(/\/+$/, "");
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
  /** The same idea for /api/media, and longer on purpose: that payload asks
   *  seven separate services rather than one Prometheus, and a single one of
   *  them being unreachable costs a full `timeoutMs` before the rest can be
   *  assembled. At 3 s every poll through a dead Jellyfin would report itself
   *  stale while the numbers beside it were in fact fresh. */
  mediaBudgetMs: Number(process.env.MEDIA_BUDGET_MS ?? 9000),

  prometheus: (process.env.PROMETHEUS_URL ?? "http://prometheus:9090").replace(/\/+$/, ""),
  loki: (process.env.LOKI_URL ?? "http://loki:3100").replace(/\/+$/, ""),

  /** The Docker API, reached only through tecnativa/docker-socket-proxy on an
   *  internal network. The hub never mounts the socket itself, and this is the
   *  reason why: `:ro` on a docker socket does not make the Docker API
   *  read-only. It applies to the file node, not the protocol, so
   *  `POST /containers/x/stop` still works through a read-only mount -- and so
   *  does `POST /containers/create` with `Binds: ["/:/host"]`, which is root on
   *  the box. The proxy is the layer that still holds if this server has a bug.
   *
   *  Unset means the containers page falls back to what cAdvisor can see, which
   *  is running containers only. That is a degraded page, not a broken one. */
  docker: (process.env.DOCKER_HOST ?? "").replace(/^tcp:\/\//, "http://").replace(/\/+$/, ""),

  /** Dokploy, for the redeploy action. There are no scoped tokens in Dokploy:
   *  this key can delete every service on the box, so the ids it may be used
   *  against are allow-listed rather than free-form. */
  dokployUrl: process.env.DOKPLOY_API_KEY ? boxUrl("DOKPLOY_URL", 3000) : "",
  dokployKey: process.env.DOKPLOY_API_KEY ?? "",
  dokployAllow: (process.env.DOKPLOY_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /** Where the append-only action audit lands. A named volume in the compose
   *  file, so it survives a redeploy -- an audit log that a deploy erases is a
   *  log of the last five minutes. */
  auditPath: process.env.AUDIT_PATH ?? "/data/actions.jsonl",

  /** The *arr and qBittorrent endpoints the media pages read and the media
   *  actions write to. Every one of these is blank until scripts/collect-env.sh
   *  has run on the box; a blank one makes its actions `unconfigured` rather
   *  than failing at the click, and its pipeline node say which key is missing
   *  rather than drawing an empty card.
   *
   *  Radarr and Sonarr answer the same v3 API; Prowlarr, Bazarr and Jellyseerr
   *  each answer their own. All five keep their key in a file inside their own
   *  container, which is why none of them is ever typed in. */
  radarr: { url: boxUrl("RADARR_URL", 7878), key: process.env.RADARR_API_KEY ?? "" },
  sonarr: { url: boxUrl("SONARR_URL", 8989), key: process.env.SONARR_API_KEY ?? "" },
  prowlarr: { url: boxUrl("PROWLARR_URL", 9696), key: process.env.PROWLARR_API_KEY ?? "" },
  bazarr: { url: boxUrl("BAZARR_URL", 6767), key: process.env.BAZARR_API_KEY ?? "" },
  jellyseerr: { url: boxUrl("JELLYSEERR_URL", 5055), key: process.env.JELLYSEERR_API_KEY ?? "" },
  qbittorrent: {
    url: boxUrl("QBITTORRENT_URL", 8080),
    user: process.env.QBITTORRENT_USER ?? "",
    pass: process.env.QBITTORRENT_PASS ?? "",
  },
  /** Jellyfin is read only. The default reaches it through its public
   * Cloudflare hostname, so a successful sessions query proves the same path a
   * viewer uses; set JELLYFIN_URL only when a private route is intentional. */
  jellyfin: {
    /* Jellyfin is served *under* the Cinema hostname, at /jf -- there is no
     * jellyfin.davideghiotto.it any more. Without the suffix every call landed
     * on the Cinema SPA, which answers 200 text/html to anything. */
    url: (process.env.JELLYFIN_URL ?? `${CINEMA_PUBLIC_URL}/jf`).replace(/\/+$/, ""),
    key: process.env.JELLYFIN_API_KEY ?? "",
  },

  /** The manga lane, its own compose project in ~/manga. Suwayomi has no auth.
   *  Kavita's key is the admin's own auth key, read out of kavita.db by
   *  collect-env.sh. Yomu is asked through its public hostname on purpose, the
   *  way Jellyfin is through Cinema's: an answer proves the path a reader takes. */
  suwayomi: { url: boxUrl("SUWAYOMI_URL", 4567) },
  kavita: { url: boxUrl("KAVITA_URL", 5000), key: process.env.KAVITA_API_KEY ?? "" },
  yomu: { url: MANGA_PUBLIC_URL.replace(/\/+$/, "") },

  /** TypeSafe's Jev, which turns a typed question into a typed answer and is
   *  what /api/ask uses to read a sentence. The only address in this file that
   *  is not on the box or the tailnet, and the only one a prompt leaves through:
   *  the request carries the user's words and the series catalogue, never a
   *  metric value. Blank key means /api/ask reports itself unavailable with the
   *  reason and the composer will not open, which is the intended degraded
   *  state -- every other page is unaffected. */
  jev: {
    url: (process.env.JEV_URL ?? "https://api.typesafe.ai").replace(/\/+$/, ""),
    key: process.env.JEV_API_KEY ?? "",
    /** Jev answers in 70-500 ms, but it is off-box and behind a tunnel of its
     *  own, so this is sized for a bad day rather than a good one. Still well
     *  under the 6 s default being wrong in the other direction. */
    timeoutMs: Number(process.env.JEV_TIMEOUT_MS ?? 20_000),
  },

  /** All-in marginal tariff. The Grafana dashboard's textbox defaults to the
   *  same 0.27 EUR; see monitoring/README.md for the derivation. */
  costPerKwh: Number(process.env.COST_PER_KWH ?? 0.27),

  /** Addresses shown on the topology page.
   *
   *  These are **declared, not discovered**, and that is not a slip. Every
   *  scrape job relabels `instance` to `homelab` or `nas`, so nothing in the
   *  metrics carries a real address any more -- which is the right trade for
   *  every other page and leaves this one with nothing to read.
   *
   *  It does not break the no-LAN-IP-defaults rule either: nothing here is ever
   *  dialled. They are captions. A wrong one prints a wrong caption; a wrong
   *  address in `boxUrl` breaks the hub. Override any of them when DHCP moves. */
  topology: {
    boxLan: process.env.TOPO_BOX_LAN ?? "192.168.15.126",
    boxTailnet: process.env.TOPO_BOX_TAILNET ?? "",
    nasTailnet: process.env.TOPO_NAS_TAILNET ?? "",
    plugLan: process.env.TOPO_PLUG_LAN ?? "192.168.15.132",
    routerLan: process.env.TOPO_ROUTER_LAN ?? "192.168.15.1",
    subnet: process.env.TOPO_SUBNET ?? "192.168.15.0/24",
    lokiPush: process.env.TOPO_LOKI_PUSH ?? "loki-push.davideghiotto.it",
    /** The hostname Cloudflare publishes for the NAS's own tunnel. A caption
     *  like the rest of this block -- `links.cinema` is the one that is dialled. */
    cinemaHost: process.env.TOPO_CINEMA_HOST ?? "cinema.davideghiotto.it",
  },

  links: {
    grafana: publicUrl("GRAFANA_PUBLIC_URL", 3001),
    dokploy: publicUrl("DOKPLOY_PUBLIC_URL", 3000),
    jellyfin: publicUrl("JELLYFIN_PUBLIC_URL", 8096),
    jellyseerr: publicUrl("JELLYSEERR_PUBLIC_URL", 5055),
    // The rest of the pipeline, for the node links on /media. These are where a
    // browser is sent, never where this process fetches -- see boxUrl above.
    radarr: publicUrl("RADARR_PUBLIC_URL", 7878),
    sonarr: publicUrl("SONARR_PUBLIC_URL", 8989),
    prowlarr: publicUrl("PROWLARR_PUBLIC_URL", 9696),
    bazarr: publicUrl("BAZARR_PUBLIC_URL", 6767),
    qbittorrent: publicUrl("QBITTORRENT_PUBLIC_URL", 8080),
    // LAN only, both of them: Suwayomi has no login and Kavita's admin UI is not
    // on the tunnel. Yomu, the public half, links to its own hostname.
    suwayomi: publicUrl("SUWAYOMI_PUBLIC_URL", 4567),
    kavita: publicUrl("KAVITA_PUBLIC_URL", 5000),
    // Both of these live on the NAS and are only ever reached by their public
    // hostnames, so there is no port fallback that would work.
    cinema: CINEMA_PUBLIC_URL,
    immich: process.env.IMMICH_PUBLIC_URL ?? "",
  },
} as const;
