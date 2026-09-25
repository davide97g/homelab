# Hub

`monitoring.davideghiotto.it` — one entry point for the whole homelab: the mini
PC, the NAS, their metrics, their logs, and the handful of things worth being
able to change from a browser.

**Naming, because it will confuse someone in six months.** This repo is
`homelab/hub` and it serves `monitoring.davideghiotto.it`. The repo next door,
`homelab/monitoring`, is the Prometheus/Grafana/Loki *stack* this reads from. It
used to serve `grafana.davideghiotto.it`; that hostname was removed on
2026-09-19 and this hub is now the only public entrance. Grafana itself still
runs, on the LAN at `http://debian:3001`. The hub stores nothing and collects
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
| `server/src/jev/` | `/api/ask`: a sentence → a chart spec, decided by Jev. Client, questions, validator. |
| `deploy.py` | Manual deploy of `main` through Dokploy; `--direct` is the no-Dokploy fallback. |
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

**Push to `main`** — see [Deploying](../../README.md#deploying). Dokploy's `hub` app (app name `hub`, so the compose project,
container and `hub_hub-data` volume are the ones that were already there) clones the repo and runs
`up -d --build` in `apps/hub`: the image is built on the box, there is no registry. Secrets live
in its Environment tab.

```sh
./deploy.py              # deploy main now, without a push
./deploy.py --direct     # Dokploy is down: tar to ~/hub, build, compose up with ~/hub/.env
./deploy.py --logs       # follow the container log afterwards
```

`collect-env.sh` still writes `~/hub/.env` on the box; copy what it collects into the Dokploy
Environment tab, which is what the deployed hub reads. Then, once,
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

Live at `https://monitoring.davideghiotto.it`, gated by Cloudflare Access. Same
shape as `grafana.`: nothing is open inbound, the box dials out.

```
browser → Cloudflare edge → Access policy → tunnel → localhost:3003
```

Three edits, all made with `CF_API_TOKEN` from the homelab `.env`:

| What | Where |
|---|---|
| Proxied `CNAME` `monitoring` → `$CF_TUNNEL_ID.cfargotunnel.com` | `zones/$CF_ZONE_ID/dns_records` |
| Ingress rule `monitoring.davideghiotto.it` → `http://localhost:3003` | `accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations` |
| Access application `hub`, reusing grafana's `email-access` policy | `accounts/$CF_ACCOUNT_ID/access/apps` |

**The tunnel config API replaces the whole ingress list.** Read it, edit it,
write it back, and keep the `http_status:404` catch-all last or it swallows every
rule after it.

The Access policy is Cloudflare's reusable one, attached by id rather than
copied, so there is one place to change who gets in rather than one per
hostname.

`COOKIE_SECURE=true` is now set in `/home/davide/hub/.env`. Two consequences,
both inherited from mediarr-dash and both easy to be surprised by:

- A browser will not store a `Secure` cookie over plain HTTP, so
  `http://<box>:3003` can no longer complete a login. End-to-end verification
  runs on the box against `127.0.0.1:3003`.
- Access gates `/healthz` too, so an external uptime probe needs its own Access
  application scoped to that path with action **Bypass**. Not set up: nothing
  probes it yet.

## What is built

| Route | State |
|---|---|
| `/` Topology | **Built.** The landing page: both flats on a ground plane, every device modelled, and the paths between them animating at their real cadence. WebGL with a flat SVG twin. |
| `/atlas` Atlas | **Built.** The same estate, read as what runs on it: media services and containers orbit the machine they belong to. Topology is unchanged. |
| `/overview` Overview | **Built.** Hero, power dial, the mini PC's headline metrics, energy and cost, busiest containers, the NAS card, alerts, links out. |
| `/compute` `/power` `/network` | **Built.** The series registry and the uPlot chart layer. |
| `/storage` | **Built.** The same charts, under an occupancy recap: capacity, free space and the weekly fill trend per filesystem, from `/api/storage`. |
| `/nas` | **Built.** Pool, md arrays stated honestly, the four bays, sensors, its containers, and its own charts. |
| `/containers` | **Built.** Both machines, running and stopped, with start/stop/restart on the ones the deny-list allows. |
| `/logs` | **Built.** Loki behind structured filters, with a 5 s live tail. |
| `/actions` | **Built.** The dispatcher, the media writes, Dokploy redeploy, and the audit. |
| `/ask` Pinned answers | **Built.** Answers kept from the composer. Specs in `localStorage`, re-queried live on every visit. |
| `/media` | **Built.** The pipeline as a graph: seven services, live numbers on each card, the lists behind them in a drawer, and edges that animate only where something is moving. This is what mediarr-dash used to be — that app was retired on 2026-09-20. Since 2026-09-24 a second row carries the manga stack (`~/manga`): Suwayomi → Kavita → Yomu, collected in `server/src/media/collect/manga.ts`. Suwayomi needs no key; Kavita's is read out of `kavita.db` by `collect-env.sh`; Yomu is asked through `manga.davideghiotto.it`. |

Every route is built. A service whose key has never been collected still draws
its node — it says which key is missing rather than showing an empty panel that
looks broken.

## Asking for a chart

⌘K, or the sparkle in the top bar, opens a composer at the bottom of the screen:
one sentence, typed or dictated, and the answer renders above it. "temperatures
of the mini pc and the NAS compared, last 2 weeks, line at 50°" comes back as a
two-machine panel over a 14-day window with a dashed line at 50 °C.

**The model does not write the query. It picks from a list.** Jev, TypeSafe's
System One model, does not generate text at all: you hand it a `state` and a set
of typed `questions` — `choice`, `score`, `noul` — and it answers all of them in
parallel with calibrated probabilities. `server/src/jev/questions.ts` builds one
question per series in `prom/registry.ts` plus seven more for shape, machine,
range, threshold, ranking and fit; `ask.ts` checks every id it picks against
`SERIES`, exactly as `parseRequest` checks the browser. **No PromQL exists
anywhere in this path.** The registry's guarantee is untouched.

**Numbers come from the text, semantics come from the model.** "50", "2 weeks"
and "10" are pulled out of the prompt by regex *before* Jev is called. Jev is
asked whether the request wants a threshold, never what the threshold is. A
model that emits no tokens cannot invent a limit nobody typed.

**Refusing is a normal answer.** The catalogue is finite, so "no" has to be
useful: the composer says what it read — range, machine, threshold — and offers
the candidates that did not clear the floor as chips, plus the same Grafana
Explore link every panel carries. "What is the weather in Rome tomorrow" scores
0.00 on fit and is turned away with no chips at all, because nothing is near.

**The wording of a question is load-bearing, and it was measured.** Asking "the
request asks for this metric: X" scores a correct match at **0.24**; asking
whether X *would answer* the request scores the same match at **0.94** and the
wrong one at 0.03. And the subject has to be `SeriesDef.asks`, not `title` and
`description` — those are written for someone already looking at the panel
("Throughput. Transmit is drawn below the axis"), and feeding them to a
sufficiency question scored a plainly correct network request at 0.32, below the
floor, so it refused. Every series carries an `asks` sentence for this reason.
**Add one when you add a series**, or it will not be findable.

**What leaves the box.** This is the only feature that sends anything off it.
The prompt and the catalogue's `asks` sentences go to `api.typesafe.ai`; metric
values never do, because Jev picks ids and Prometheus is queried afterwards,
here. Every prompt is written to the same audit as the write actions, as
`chart.generate`. The route is rate-limited at 12/min — a shared password is not
a spending control — and `JEV_API_KEY` blank means the button greys itself out
with the reason.

**Dictation is the browser's, not ours.** `webkitSpeechRecognition`, no audio
leaves the machine for the hub, no second key. It needs a secure context, so the
mic hides over plain HTTP and appears through the tunnel; Firefox gets the typed
fallback.

## Decisions worth not undoing

**`/media` is mediarr-dash's page, with its two structural mistakes fixed.**
That app is gone: container removed, `mediarr.davideghiotto.it` unpublished —
ingress rule, Access application and DNS record all deleted on 2026-09-20 — and
the tree kept at `../../archive/dashboard` as a read-only reference. Every mention of it
below is about its *code*, which is still the reference for anything this port
got wrong, not about something running.
The shape is that app's and deliberately unchanged: one node per service, left
to right in the order a request actually travels, live numbers on the cards and
the lists behind them one click away. React Flow draws it, for the same reason
it drew the original — hand-rolling pan, zoom and edge routing buys nothing
here. It is a lazy chunk, so a visit that never opens `/media` never loads it.

What did change is where two decisions live. **The host is not in
`/api/media`**: the card for the box is filled from `/api/summary`, which the
shell is already polling, so one machine has exactly one source of numbers
instead of two endpoints that can disagree about the same CPU. And **an edge
animates only when the server says it is carrying something**, decided in
`server/src/media/pipeline.ts` from the raw figures each collector hands up
alongside its card. mediarr-dash decides that in the browser by finding a stat
by its English label and parsing the digits back out of its display string,
which stops working the day a label is reworded — silently, because a still
arrow looks exactly like an idle pipeline.

**Capacity is an instant question and the storage page answers it with
numbers, not a chart.** A line at 77% says the ratio and nothing about whether
that is 300 GB or 3 TB free, which is the thing you opened the page for. So
`/api/storage` reports sizes, free space and a seven-day `deriv` fit of used
bytes per filesystem, and the panels stay underneath answering the other half —
*which day* the fill happened.

Three rules hold that honest. **Every bar is drawn to one absolute scale**, the
whole estate, so the mini PC's root cannot look like the NAS's pool; two bars
each normalised to their own 100% would say those are comparable objects and
they are not. **A filesystem mounted twice is one filesystem** — UGOS
bind-mounts the pool at `/home`, and summing mountpoints would report the NAS at
twice its size and half as full — so mounts are grouped by device and the extra
paths are shown as aliases. And **a slope below 16 MiB/day is reported as
steady**: a week of scrapes always fits *some* gradient, and extrapolating that
one to a date invents a deadline.

**A machine that is not answering still has a pool.** When Prometheus has no
current sample the recap falls back to the last one within a week, dims the
card, and prints its age — the NAS has been off the tailnet for more than a day
before, and "8.0 TB, 55% full, as of yesterday" is worth more than an empty
card. It is left out of the estate total, which counts only machines reporting
now, and the total says which those are. Note the trap in reading that age:
`timestamp(last_over_time(...))` looks like it answers it and does not —
`last_over_time` restamps its sample with the evaluation time, so it cheerfully
reports "now" for a machine that died yesterday. The real sample time needs the
subquery in `server/src/collect/storage.ts`.

**Nothing on the topology page moves unless something measures it.** A link with
no metric behind it carries `rate: null`, and it must never be rendered as a
zero: a zero is a measurement, and drawing the absence of one the same way is
where a dashboard starts lying. There is a whole link on that page — the NAS's
own tunnel out to `cinema.` — that nothing in this stack observes, and it sits
perfectly still and says so. The corollary is the nice half: a *pulled* link
knows its scrape interval, so it fires one bead per interval rather than a
continuous flow, and you can watch Prometheus scrape.

**The Cloudflare edge's status is evidence, not a metric.** `cloudflared` is a
host systemd service on both boxes and exports nothing here, so there is no
series to read. What is knowable is whether pushed NAS log lines have arrived,
and that single fact clears Alloy, its egress, the Access service token, the
ingress rule and Loki's write path at once. Ten minutes of silence downgrades it
to `warn` with the reason, rather than leaving a green dot the payload cannot
justify. Every latency on that page is likewise a **scrape round trip and says
so** — there is no blackbox exporter in this estate and nothing here may be
called a ping.

**Both public hostnames are Cloudflare's, and the picture is drawn to say so.**
Nothing in this estate has a port open to the internet: `loki-push.` reaches the
mini PC down a tunnel `cloudflared` dialled outward, and `cinema.` reaches the
NAS down a second, entirely separate one. So the cloud column holds two edges
rather than one — they have two credentials and two failure modes, and only the
first has any evidence behind it — plus a `viewer` node standing for whoever is
watching Jellyfin, because "the NAS is reached *through* Cloudflare" is the fact
a reader will otherwise replace with "there must be a forwarded port on Ilario's
router", and there is not one. Every link also carries an arrowhead pointing the
way the connection is **dialled**. That is not motion and it is drawn on the
unmeasured paths too: who dials whom is a fact about the configuration and is
known even where the rate is not.

**The flats are drawn as glass houses.** They used to be a wireframe box, which
never read as a building, and the alternative — solid walls — would have hidden
whichever machine was behind them. Four walls and a pitched roof at six per cent
opacity catch just enough light to say "there is a surface here" while the
hardware inside stays legible through it, and the whole building is two draw
calls: one triangle soup, one line list. Both are `depthWrite: false`, because a
transparent surface that writes depth punches a hole in everything queued behind
it. The flat SVG twin draws the same house as a line drawing, and the page sits
on a dot field so that orbiting the camera moves the estate against something
rather than against nothing.

**The topology camera has no fixed position.** The field of view is vertical, so
a taller canvas *narrows* what is visible horizontally — giving the picture the
full height of the page therefore zoomed it in and pushed both flats off the
sides. The camera now takes the eight corners of the estate's bounding box,
which `layout.ts` derives from the node positions rather than hard-coding, and
solves for the closest distance that keeps all of them inside both frustum
planes. It re-solves whenever the canvas changes shape, and stops as soon as the
reader takes the camera; "Reset view" hands it back rather than restoring a
saved position that was right for a different window.

**Theme tokens are resolved by painting a pixel, not by reading a computed
style.** `charts/theme.ts` used to set a token on a throwaway element and read
`getComputedStyle().color` back. That quietly stopped working: the computed
value of `color` preserves the colour function, so Chrome returns
`oklch(0.265 0.013 63)` unchanged. uPlot never noticed, because a canvas fill
parses `oklch()` fine — but `THREE.Color` cannot, and falls back to **white**
without throwing, so every material in the 3D scenes was painting white over
whatever token it had been given. It now fills one pixel and reads it back,
which is sRGB bytes by definition.

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

**A phone is a first-class reader, not a narrow desktop.** The palette note in
`index.css` says the box gets looked at from a phone in a dark room as often as
from a desk, and the layout now means it. Four things follow from that and none
of them should be undone by a "just make it fit" edit later:

- **The numbers come before the picture.** On `/overview` and `/nas` the machine
  and its dial sit shoulder to shoulder below `sm` rather than stacked. Stacked
  they are ~520px of hero, which is a whole phone screen, and every figure on
  the page starts below the fold — on a page whose entire job is the figures.
- **Two lists stop being tables.** A containers row and a log line are both
  three columns whose right-hand column is a fixed ~270px and ~200px; at 390px
  that left the container's *name* about two characters wide and the log message
  a ten-character ribbon. Both stack below `sm` and return to the grid above it.
  Anything added to either list has to answer the same question.
- **Touch targets are 44px below `sm` and mouse-sized above it.** That lives in
  `toggle.tsx` for every segmented control at once — the range picker, the log
  levels, the container scope — rather than per caller.
- **`dvh`, never `vh`, and `env(safe-area-inset-*)` on the shell.** `vh` is the
  *large* viewport on mobile Safari, so a `62vh` pane is taller than the space it
  was given; and without `viewport-fit=cover` in `index.html` the insets are all
  zero and the rail runs under the notch.

The one interaction that changes shape rather than size: the log filter strip is
six fields, which is a strip on a desktop and most of a phone screen before a
single line of log. Host, level and window stay; the three text fields fold
behind **more filters** below `sm` and are always present above it.

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
