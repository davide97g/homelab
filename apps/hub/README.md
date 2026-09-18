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
| `/compute` `/power` `/network` `/storage` | Routes exist, waiting on the series registry and chart layer. |
| `/containers` | Waiting on the Docker socket proxy. |
| `/logs` | Loki is running and ingesting; the query proxy and viewer are next. |
| `/media` `/actions` | Waiting on the actions layer. |
| `/nas` | Its metrics are already collected; the page and its 3D model are next. |

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
