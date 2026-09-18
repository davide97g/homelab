# Hub

`monitoring.davideghiotto.it` — one entry point for the whole homelab: the mini
PC, the NAS, their metrics, their logs, and the handful of things worth being
able to change from a browser.

**Naming, because it will confuse someone in six months.** This repo is
`homelab/hub` and it serves `monitoring.davideghiotto.it`. The repo next door,
`homelab/monitoring`, is the Prometheus/Grafana/Loki *stack* this reads from, and
it serves `grafana.davideghiotto.it`. The hub stores nothing and collects
nothing; it is a reader.

## Layout

| Path | Role |
|---|---|
| `server/` | Hono on Node. Serves `/api/*` and the built page. |
| `server/src/wire.ts` | The whole browser/server contract. Types only. |
| `frontend/` | Vite + React 19 + Tailwind v4, shadcn/ui components. |
| `Dockerfile` | Builds both, ships one container. |
| `docker-compose.yml` | What runs on the box. |
| `server/src/prom/registry.ts` | Every PromQL expression the hub can ask for. |
| `server/src/loki/query.ts` | Structured log filters → LogQL. Nothing else assembles a query. |
| `server/src/actions/` | The one write path: registry, dispatcher, audit. |
| `deploy.py` | Copy up, build there, bring it up. |
| `scripts/collect-env.sh` | Runs **on the box**, writes `.env` mode 600. |

**One container, one origin, one port.** The server serves the API and the page,
so there is no CORS to configure, the session cookie is same-origin by
construction, and the tunnel has exactly one thing to point at. This is the shape
mediarr-dash already proved on this box; do not split it without a reason.

### The wire contract

`server/src/wire.ts` holds every type the browser and server share, and the
frontend imports it through the `@wire` Vite alias rather than keeping a copy.
It is types only, imported with `import type` under `verbatimModuleSyntax`, so
nothing from it reaches the bundle — a compile-time link, not a dependency.

mediarr-dash hand-mirrors its types between two files and nothing catches a
drift. That is survivable for one payload and would not be for this many.

The one hand-mirrored pair left is `server/src/format.ts` and
`frontend/src/lib/format.ts`, because those are code rather than types. Numbers
are formatted **on the server** and the browser prints `Metric.display`, so the
two can only disagree about the handful of values the browser derives itself.

## Deploy

```sh
./deploy.py              # sync, build the image on the box, bring it up
./deploy.py --no-build   # redeploy the image already there
./deploy.py --logs       # follow the container log afterwards
```

The image is built on the box: there is no registry in this setup. Then, once,
on the box:

```sh
ssh -t homelab 'bash ~/hub/scripts/collect-env.sh'
```

That writes `/home/davide/hub/.env` mode 600. With `NONINTERACTIVE=1` it asks
nothing and generates a password, which you read back out of that file. **The
secrets never leave the box** — not into this repo, not onto a laptop, not
through an agent session.

The hub lands on `http://debian:3003`. It joins the monitoring stack's Docker
network, which is the only reason `http://prometheus:9090` and
`http://loki:3100` resolve — neither publishes a port.

### Through the tunnel

Cloudflare Zero Trust → Networks → Tunnels → Public Hostname:
`monitoring.davideghiotto.it` → `HTTP localhost:3003`. Then an Access
application over that hostname with the same policy as the mediarr one, and
`COOKIE_SECURE=true` in `.env`.

Two consequences of that last flag, both inherited from mediarr-dash and both
easy to be surprised by:

- A browser will not store a `Secure` cookie over plain HTTP, so
  `http://<box>:3003` can no longer complete a login. End-to-end verification
  runs on the box against `127.0.0.1:3003`.
- Access gates `/healthz` too, so an external uptime probe needs its own Access
  application scoped to that path with action **Bypass**.

## What is built

| Route | State |
|---|---|
| `/` Overview | **Built.** Hero, power dial, the mini PC's headline metrics, energy and cost, busiest containers, the NAS card, alerts, links out. |
| `/compute` `/power` `/network` `/storage` | **Built.** The series registry and the uPlot chart layer. |
| `/nas` | **Built.** Pool, md arrays stated honestly, the four bays, sensors, its containers, and its own charts. |
| `/containers` | **Built.** Both machines, running and stopped, with start/stop/restart on the ones the deny-list allows. |
| `/logs` | **Built.** Loki behind structured filters, with a 5 s live tail. |
| `/actions` | **Built.** The dispatcher, the media writes, Dokploy redeploy, and the audit. |
| `/media` | Waiting on the Jellyfin and Jellyseerr keys. Its *write* side already exists on `/actions`. |

Each unbuilt route says what it is waiting on rather than showing an empty panel
that looks broken.

## Decisions worth not undoing

**`/api/series` will take an id, never PromQL.** Accepting a query string from
the browser would put a query engine behind one password: a single
`rate(...[30d])` across 180 days of TSDB can stall Prometheus for the whole
stack, including its own alert evaluation. A registry of named series also keeps
every expression in one reviewable file and makes responses cacheable by key.
The cost is that a new panel is a server deploy, which is why every panel will
carry an "open in Grafana" link built from the same expression.

**The first paint of a window streams; everything after it is batched.** A cold
metric page is a dozen Prometheus range queries, and the NAS is a minute-
resolution scrape reached over the tunnel, so the slowest one used to decide when
*any* chart appeared — six panels sat as grey boxes for half a minute and the page
read as broken. `/api/series/stream` hands each frame over as it resolves, so the
page fills in. Once the panels are up the server has them cached and the page
goes back to `/api/series`, which is one request per tick carrying every id
rather than one request per panel.

**Both machines are shown at once, and isolating one is the zoom.** The two boxes
answer the same questions differently and the interesting reading is usually the
difference, so a metric page is two aligned columns rather than a toggle between
them. Clicking a column header drops the other, gives this one the full width and
stops querying Prometheus about the machine you are not looking at.

**Refresh is one thing the app does, not one thing per page.** The button used
to re-poll `/api/summary` and nothing else, so on a metric page it spun and
changed nothing you were looking at. Pages register what refreshing means for
them — re-read the charts, pull the tail forward — and the button runs all of
them and waits for the lot, which is also what tells the sweep in the header
when to stop. The background poll deliberately does not raise it: a page that
re-reads itself every five seconds would show a permanent indicator, which is
the same as no indicator at all.

**A chip inside a pressed track is `--chip`, never `--card`.** In the light
theme card is lighter than muted and a selected segment reads as raised; in the
dark theme card is *darker* than muted, so the same class turns the selection
into a hole punched in its own track. `--chip` is defined per theme to be the
lighter of the two, and every selected segment, toggle and hovered log row uses
it. `--card` stays what it is: the surface for things that sit on the page.

**No interface name is hard-coded.** The box is `enp3s0`, the NAS is `eth0`, and
mediarr-dash still asks Prometheus about `eno1` — a NIC with no cable, so its
host card's throughput has read zero since the day it was written. The hub
resolves the busiest real interface per machine and caches the answer for ten
minutes, because it changes when hardware does and not before.

**`/api/summary` runs against a hard budget.** Three sources fan out into one
payload, so past `SUMMARY_BUDGET_MS` the last good payload is served with
`stale: true` and the top bar says so. Without it a NAS that has gone quiet over
a relayed tailnet hop would hold the mini PC's numbers hostage.

**Package power is the averaged rail, not the live one.**
`node_hwmon_power_watt` is an instantaneous PPT reading that bursts well above
the sustained draw — over one hour it averaged 15.5 W against a 20.3 W wall
reading while peaking at 42.1 W. Put next to a plug reading that is itself an
average, single samples land above it and read as impossible. So the hub shows
`homelab:power_package_watts:avg`.

**Hotspots are computed on the server.** The values that drive the 3D models
come down in the payload, so the browser holds no metric-to-visual logic and the
WebGL scene and the flat SVG fallback are fed from exactly one place.

**Alerts are read-only and stay that way.** There is no Alertmanager on the box,
so an acknowledge button whose state lived only in this process would be worse
than no button: it would look like the alert had been handled.

**The Docker socket is never mounted into the hub.** `:ro` on a socket mount
does not make the Docker API read-only — it applies to the file node, not the
protocol. `POST /containers/x/stop` works through one, and so does `POST
/containers/create` with `Binds: ["/:/host"]`, which is root on the box. So the
hub talks to a socket proxy on an `internal: true` network and holds no socket
of its own. The proxy is the layer that still holds if this server has a bug.

**The proxy filters by method and path, not by resource.** This is
`wollomatic/socket-proxy`, not the more common
`tecnativa/docker-socket-proxy`, and the difference is the whole point.
Tecnativa's flags are per-resource: `CONTAINERS=1` with `POST=1` allows every
POST and DELETE under `/containers` — which includes `create` (with any bind
mount, so root on the host), `exec`, `kill` and `remove`, not just the three
verbs this needs. That was measured on the box, not assumed: against that
config `POST /containers/{id}/exec` answered **201** and `POST
/containers/create` reached the daemon. Its `ALLOW_START` and `ALLOW_RESTARTS`
variables do not rescue it, because the rule above them denies every non-GET
unless `POST` is set, so they are unreachable.

The replacement takes a regex per method, so the allow-list *is* the set of
requests the hub can make:

```
-allowGET  /(v[0-9.]+/)?(version|info|_ping|containers/json|containers/[a-zA-Z0-9_.-]+/json)
-allowPOST /(v[0-9.]+/)?containers/[a-zA-Z0-9_.-]+/(start|stop|restart)
```

Everything else is 403 — images, volumes, networks, events, exec, create,
delete, `kill`, and path traversal out of `/containers`. `kill` is left out on
purpose: the dispatcher offers a graceful stop, and a path that skips the grace
period is not one the hub should be able to take by accident.

Two operational notes. The image runs as `nobody`, so it needs the host's
docker group to read the socket — `DOCKER_GID`, which `collect-env.sh` reads off
the box rather than baking in. And it is distroless, so it carries **no**
healthcheck: a compose healthcheck of any shape would exit -1 and mark a
perfectly healthy proxy unhealthy forever, exactly as happened to Loki in the
monitoring stack. Whether it works is visible where it matters — `/api/containers`
reports `source: "cadvisor"` instead of `"docker"` the moment it does not.

**`/api/logs` takes filters, never LogQL.** Same reasoning as the series
registry, with a sharper edge: a stream selector is mandatory in LogQL, but
`{job=~".+"}` is a legal one and over 30 days of retention that is every line
the stack has written. `contains` becomes an escaped `|=` rather than a user
regex, because a catastrophically backtracking pattern cannot be detected
reliably before running it.

**The log level filter speaks two vocabularies.** `level` is a real stream label
and only journal streams have one — Alloy sets it from the syslog priority, so
it says `err` and `warning`. Docker streams have no level label at all; they
have Loki's `detected_level`, which says `error` and `warn`. A filter that knew
one of the two would silently return nothing for half the stack, which reads
exactly like "there are no errors".

**One action dispatcher, not a route per action.** Auth, throttle, confirmation,
idempotency, audit and error shaping happen once. Split across twelve routes
they would happen eleven times and then not the twelfth. Idempotency keys are
client-generated and held for five minutes, which covers a double-click, a
tunnel replay and a retry-after-timeout with one mechanism; the stored entry is
the in-flight *promise*, so a key arriving mid-call waits rather than starting a
second one.

**The audit records attempts, not successes.** Refusals are the interesting
half: "nothing happened" and "something tried and was stopped" look identical
from outside. It lives on a named volume, because `deploy.py` clears the
directories it owns and an audit log a deploy erases is a log of the last five
minutes.

**Dokploy's key is allow-listed by app id.** Dokploy has no scoped tokens: the
key can delete every service on the box. `DOKPLOY_ALLOW` is `label=composeId`
pairs, and it is the only thing between a bug here and that.

**The NAS page does not claim a RAID level.** node_exporter does not export one.
It exports `node_md_disks_required`, and that is the number that decides whether
the word means anything: `md1` requires one member, so `node_md_degraded` reads
0 and will keep reading 0 right until that disk dies.
