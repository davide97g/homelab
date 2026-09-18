# Monitoring

Prometheus + Grafana + node_exporter + cAdvisor + json-exporter + Loki + Alloy, deployed as a
single Dokploy Compose app, plus a small set of agents that run on the NAS.

Answers: how many watts is the box drawing, what is the CPU and RAM doing, how busy is the
ethernet link, which container is responsible — and, since logs landed, what that container was
actually saying at the time.

## Layout

| File | Role |
|---|---|
| `compose.base.yml` | Source of truth. Services, Prometheus config, recording rules, alert rules, Loki config, Alloy config, Grafana provisioning. |
| `dashboards/homelab-overview.json` | The metrics dashboard, kept as normal JSON so it stays diffable. |
| `dashboards/homelab-logs.json` | The logs dashboard. Same deal. |
| `build.py` | Inlines the dashboards into the compose file. |
| `deploy.py` | Builds, pushes the compose to Dokploy over its API, and deploys. |
| `nas-agents/` | node_exporter + cAdvisor + Alloy for the NAS. Plain compose over SSH, its own `deploy.py`. |
| `.dokploy.env` | **Gitignored.** Dokploy URL, API key, compose id used by `deploy.py`. |
| `docker-compose.yml` | **Generated.** Self-contained — paste it into Dokploy as-is. |

Edit `compose.base.yml` or a dashboard, then:

```sh
./build.py
```

Never edit `docker-compose.yml` by hand; `build.py` overwrites it.

Everything is inlined as compose `configs`, so there are no side files to copy to the box. That
is what makes a Dokploy Raw compose app viable.

## Deploy

Once the stack exists in Dokploy, deploying is one command:

```sh
./deploy.py              # build, push, deploy
./deploy.py --recreate   # same, but stop the stack first
```

Use `--recreate` whenever `compose.base.yml` **configs** or a dashboard changed. `docker compose
up -d` compares the service spec, not the *content* of an inline `configs:` entry, so a plain
deploy leaves the previous dashboard JSON mounted and nothing appears to happen. Recreating
costs a few seconds of monitoring downtime; the `grafana-data` and `prometheus-data` volumes are
untouched.

Credentials live in `.dokploy.env`, which is gitignored and `chmod 600`:

```
DOKPLOY_URL=http://debian:3000
DOKPLOY_API_KEY=<Dokploy → Settings → API/CLI>
DOKPLOY_COMPOSE_ID=<dokploy-compose-id>
```

The key is a full-access Dokploy token stored in plaintext on this machine. It can deploy,
modify, and delete every service on the box. Keep it out of git, and rotate it in Dokploy →
Settings → API/CLI if it is ever shared or copied elsewhere.

### First-time setup

1. Dokploy → project → **Create Service → Compose**.
2. Provider **Raw**, paste the whole of `docker-compose.yml`.
3. **Environment** tab, set:
   ```
   GRAFANA_ADMIN_PASSWORD=<pick one>
   QBITTORRENT_USER=<the qBittorrent WebUI login>
   QBITTORRENT_PASS=<its password>
   ```
   The compose file refuses to start without all three, on purpose — `${VAR:?}` fails the whole
   file rather than starting the stack with a broken exporter. The corollary is that adding a
   `${VAR:?}` and deploying before the variable exists takes the stack down, so set them first.
   The qBittorrent pair is the same one already in `/home/davide/mediarr-dash/.env`.
4. Deploy.
5. Copy the compose id out of the browser URL into `.dokploy.env`, and from then on use
   `./deploy.py`.

Grafana lands on `http://debian:3001`, user `admin`. Prometheus and cAdvisor are not
published to the LAN — they sit on the internal `monitoring` network and are reachable through
Grafana only.

Do not attach a Dokploy network to **node-exporter**: it runs with `network_mode: host` and the
two are mutually exclusive.

## Addressing

Both machines hold FRITZ!Box DHCP reservations (Rete locale → Rete → device →
*Assegnare sempre lo stesso indirizzo IPv4*):

| Device | IPv4 | MAC | Interface |
|---|---|---|---|
| homelab box (`debian`) | 192.168.15.126 | `84:47:09:a3:57:a4` | `enp3s0` |
| NOUS A1T plug | 192.168.15.132 | `40:91:51:76:29:37` | 2.4 GHz Wi-Fi |

The box has three NICs. `enp3s0` is the only one carrying traffic; `eno1` is down with no cable
and `wlp2s0` is unused. Alerts, dashboard panels and the netdev filters all key on `enp3s0`.

### The `debian` hostname resolves to a dead address

The FRITZ!Box still holds a stale lease for the hostname `debian` at **192.168.15.131**, so
`debian.fritz.box` returns two A records and nothing answers on `.131`:

```
debian.fritz.box has address 192.168.15.126
debian.fritz.box has address 192.168.15.131   <- dead
```

Roughly half of all lookups pick the dead one. `ping debian` fails while Grafana on the same
host answers — and `deploy.py` reads `DOKPLOY_URL=http://debian:3000`, so deploys can hang for
no visible reason.

Both callers now bypass DNS and use the reserved address directly:

- `.dokploy.env` → `DOKPLOY_URL=http://192.168.15.126:3000`
- `~/.ssh/config`, `Host homelab` → `HostName 192.168.15.126`. This also retired the
  `AddressFamily inet` override that existed only to stop mDNS handing back an unroutable ULA.

Changing the SSH `HostName` means host keys are looked up under the IP, which had no
`known_hosts` entry — the three `debian.local` keys were copied across rather than re-scanned,
so nothing was trust-on-first-use'd a second time.

Still worth doing in the FRITZ!Box: delete the offline `debian` entry under **Rete locale → Rete
→ Tutti i dispositivi**, so the dead `.131` record stops being served to everything else on the
LAN.

## Remote access

`https://grafana.davideghiotto.it`, gated by Cloudflare Access. No inbound port is open on the
network — the box reaches out through `cloudflared`.

```
browser → Cloudflare edge → Access policy → tunnel → localhost:3001
```

The tunnel is token-managed (`cloudflared tunnel run --token-file /etc/cloudflared/token`), so
there is no local ingress config. Hostnames live in **Cloudflare Zero Trust → Networks →
Tunnels → Public Hostname**; this one maps `grafana.davideghiotto.it` to `HTTP localhost:3001`,
bypassing Traefik. The Access policy is under **Zero Trust → Access → Applications**.

It bypasses Traefik on purpose — one less hop, and Dokploy does not need to know about the
domain. Route it through `localhost:80` instead if Traefik middlewares are ever wanted.

The two matching environment variables are set in Dokploy:

```
GRAFANA_ROOT_URL=https://grafana.davideghiotto.it
GRAFANA_COOKIE_SECURE=true
```

Without `GRAFANA_ROOT_URL`, Grafana's redirects and share links point at `localhost:3001`.

Login happens twice — once at Cloudflare, once at Grafana. Grafana can consume the Access JWT
(`auth.jwt` with the team-domain certs endpoint) to skip its own login; not wired up.

### `loki-push.davideghiotto.it`

The one write endpoint this stack exposes to the internet, and it exists solely because the NAS
cannot reach the box any other way.

```
NAS Alloy → Cloudflare edge → Access (service token only) → tunnel → localhost:3100
```

Set up and verified. Loki binds `127.0.0.1:3100`, so the tunnel is the only thing that can reach
it. Three layers, each of which holds on its own:

- **Access, service-token only.** The application over this hostname has no identity providers and
  one `non_identity` policy bound to the `nas-alloy` service token. A request without the token
  pair gets 403 at the Cloudflare edge, before the tunnel sees it.
- **Path-restricted ingress.** The tunnel rule carries `path: loki/api/v1/push`, the same shape the
  `deploy-*` hostnames already use. Anything else falls through to the catch-all 404 — so a token
  that does leak can append logs and cannot read them back. Verified: the push path answers 204
  with the token, the label API answers 404 with the same token, and everything answers 403
  without it.
- **Loopback origin.** Nothing on the LAN can reach Loki at all.

The token lives in `/home/davide/nas-agents/.env` on the NAS and nowhere else. Note that UGOS puts
a default ACL on `/home/davide` which makes new files world-readable regardless of `umask`, so
`nas-agents/deploy.py` re-asserts `700` on the directory and `600` on the `.env` every run.

## What is collected

| Source | Covers |
|---|---|
| node_exporter (host network, host PID, root) | CPU per core, memory, load, `enp3s0` throughput/errors/drops/link state, NVMe I/O and temperature, hwmon sensors, systemd units |
| cAdvisor | per-container CPU, memory, network, filesystem |
| json-exporter + NOUS A1T plug | real wall watts, volts, amps, power factor, cumulative kWh |
| qBittorrent exporter | client-wide up/down rates, all-time totals, peer and DHT counts, and torrent counts by category × status |
| Alloy | every container's stdout plus the host's systemd journal, into Loki |
| NAS agents | the same three, on the UGREEN box, over Tailscale |
| Prometheus | 180 day retention, capped at 30 GB |
| Loki | 30 day retention, compactor enforces it. No container healthcheck: the image is distroless, so any `test:` exits -1 and marks a healthy Loki unhealthy forever. `up{job="loki"}` and the `LokiDown` alert do that job properly. |

`veth*`, `docker*`, `br-*` and `lo` are excluded from network metrics — otherwise every
container interface shows up as noise.

**Everything on the overview dashboard is pinned to `instance="homelab"`.** That was not
necessary while the box was the only thing being scraped; it became necessary the moment the NAS
started reporting `node_*` and `container_*` series of its own. An unscoped expression silently
averages two machines.

### Logs

Alloy replaces Promtail, which reached end-of-life on 2 March 2026. Two sources, both labelled
`host="homelab"`:

- `job="docker"` — every container by `container`, `compose_project`, `compose_service`.
- `job="journal"` — the host side by `unit`, `level`, `identifier`. Kernel, `docker.service`,
  `cloudflared`, `tailscaled`, `sshd`.

Reading the journal over SSH needs group membership that `davide` does not have by default:

```sh
ssh -t homelab 'sudo /usr/sbin/usermod -aG systemd-journal,adm davide'
```

`usermod` lives in `/sbin`, which is not on a non-root `PATH` — hence `command not found` rather
than a permission error if you try it without the full path. Log out and back in afterwards.

The Docker daemon ships with **no log rotation**, so container JSON logs grow unbounded. Worth
fixing once, deliberately, because it restarts every container on the box:

```sh
# /etc/docker/daemon.json
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "3" } }
```

### Neither node_exporter runs --collector.processes

The first thing the logs paid for. That collector walks every host PID, the `docker-default`
AppArmor profile denies it `ptrace read` on unconfined processes, and the kernel audits each
denial — 2370 lines an hour on the mini PC, **23% of the entire journal**, which after Alloy
landed was also 23% of everything shipped to Loki:

```
apparmor="DENIED" operation="ptrace" class="ptrace" profile="docker-default"
  pid=… comm="node_exporter" requested_mask="read" denied_mask="read" peer="unconfined"
```

Nothing plots `node_processes_*`, and the two process numbers worth having —
`node_procs_running` and `node_procs_blocked` — come from the always-on `stat` collector, which
reads `/proc/stat` and needs no ptrace. So the collector is off on both boxes and the denials
stopped dead.

Re-enabling it means adding `security_opt: [apparmor=unconfined]` to node-exporter. That is a
real privilege increase for a metric no panel reads; do it only if something starts needing it.

### Why the qBittorrent metrics are not per-torrent

Tempting, and wrong twice over. A `name`-labelled series per torrent is one new time series per
torrent that ever exists, churning as they come and go — the textbook cardinality mistake, on a
box that keeps 180 days. And the exporter that does expose them,
`ghcr.io/martabal/qbittorrent-exporter`, cannot authenticate against qBittorrent 5.2.3 at all:
that version answers a **successful** `POST /api/v2/auth/login` with `204`, and the exporter
treats anything but `200` as a failed login. It logs `authentication failed, status code: 204`
forever with correct credentials.

So history is aggregate — rates, totals, and counts by category × status, which is enough to say
"it was seeding hard at 07:20". Naming the individual torrent is a live question, answered from
the WebUI API by whatever is asking.

### The NAS

The UGREEN DXP4800 Pro is Ilario's box on Ilario's network. Its shape dictates the design:

- Its `tailscaled` runs `--network host` but in **userspace mode**, so the host has no
  `tailscale0` device. Inbound tailnet traffic is proxied to the host's `127.0.0.1` — which is
  why the exporters there bind to loopback and are still scrapable, while staying invisible to
  Ilario's LAN.
- There is **no tailnet egress and no route to our LAN** (its `192.168.15.0/24` matching ours is
  a coincidence). So metrics are **pulled** and logs are **pushed out over the internet** to
  `loki-push.davideghiotto.it` on our tunnel, behind a Cloudflare Access service token. A reverse
  SSH tunnel is not an option either: its sshd sets `AllowTcpForwarding no`.
- The hop goes through Tailscale and the path is not stable: it was DERP-relayed at 35–80 ms when
  first measured and negotiated a direct connection at 3 ms an hour later. `node-nas` and
  `cadvisor-nas` therefore scrape every 60 s with a 20 s timeout sized for the relayed case, and
  `NasDown` waits 10 minutes before firing. Do not tighten either on the strength of a direct
  path that may not be there tomorrow.

`${NAS_TAILNET_IP}` is hard-coded in the scrape config. That is the one place the no-hard-coded-IP
rule below does not apply — a tailnet address is stable, and the NAS's LAN address is useless
from here.

Its `node-exporter` sets `--path.procfs=/host/proc` and `--path.sysfs=/host/sys`, which the mini
PC's does not. `--path.rootfs` alone does not redirect those two, and Docker masks
`/sys/devices/virtual/powercap` inside containers (the CVE-2020-8694 mitigation), so the RAPL
collector reports success and emits nothing at all. Reading the host's sysfs through the bind
mount fixes it, and RAPL is the only power signal that box has — it is not on a metering plug.
`nas:power_package_watts` and `nas:power_core_watts` are the recording rules.

The same fix would give the mini PC RAPL too, and it is deliberately **not** applied there. The
box already measures real wall power at the plug, so RAPL would only duplicate the CPU half of a
number we have — while `homelab:power_package_watts` joins `node_hwmon_chip_names` on `chip`, and
changing the sysfs root under a working series with 180 days of history to gain a duplicate is a
bad trade. Revisit if the plug ever goes away.

Deploy the agents separately, and note that the disk picture there is worse than the badge
suggests: four bays, **one** disk fitted, a ~2007 Seagate ST3320820AS in a single-member `md1`
raid1. `raid1` with one member is not redundancy. `/volume1` is at 82 %, and `smartctl` is not
installed, so SMART health cannot be scraped without adding it.

```sh
cd nas-agents
./deploy.py              # copy up, start node_exporter + cAdvisor
./deploy.py --with-logs  # also start Alloy, once the Access token exists
./deploy.py --pull       # pull newer images first
./deploy.py --follow     # follow alloy afterwards
```

`nas-agents/.env` holds the Cloudflare Access service token and lives **only on the NAS**, mode
600. `deploy.py` refuses to deploy if it is missing rather than creating it, so the token never
passes through this repo.

## The power numbers

Wall power is **measured**, not modelled. A NOUS A1T metering smart plug feeds the box and
Prometheus scrapes it every 15 s.

```
plug (Tasmota HTTP JSON) → json-exporter → Prometheus → homelab:power_wall_watts:estimate
```

The A1T ships with Tasmota but exposes no `/metrics` — the stock binary is built without
`USE_PROMETHEUS`. So `json-exporter` polls `http://<plug>/cm?cmnd=Status 10` and maps the
`StatusSNS.ENERGY` object onto `tasmota_*` metrics. That mapping is the `json_exporter_yml`
config in `compose.base.yml`.

The plug lives at **192.168.15.132**, MAC `40:91:51:76:29:37`, hostname
`homelab-plug-2359`. That address is a DHCP reservation on the Fritz!Box (Rete domestica →
Rete → the device → *Assegnare sempre lo stesso indirizzo IPv4*), because the scrape target is
a literal IP. `homelab-plug-2359.fritz.box` also resolves, if the target is ever moved to a
name.

### Plug settings that matter

| Setting | Value | Why |
|---|---|---|
| `PowerOnState` | `1` | Relay comes back ON after a power cut. Without this the box stays dark. |
| `TelePeriod` | `15` | Matches the scrape interval. |
| `Template` | `{"NAME":"NOUS A1T","GPIO":[32,0,0,0,2720,2656,0,0,2624,320,224,0,0,0],"FLAG":0,"BASE":49}` | BL0937 energy monitor. Without it the plug boots as a Sonoff Basic and reports nothing. |

Consider `PowerLock 1` once the box is on the plug — it stops the physical button and any stray
`Power off` from cutting the server. It also removes remote power-cycling, so it is a choice.

### Calibration

The BL0937 arrives uncalibrated and its raw numbers are nonsense (34 V, power factor 4.0).
Voltage is already set:

```sh
curl "http://192.168.15.132/cm?cmnd=VoltageSet%20230"
```

Current and power still need a **known resistive load** — an incandescent bulb, a kettle, a fan
heater. Plug it in, let it settle, then tell the plug the truth:

```sh
curl -G "http://192.168.15.132/cm" --data-urlencode "cmnd=PowerSet 2000"    # rated watts
curl -G "http://192.168.15.132/cm" --data-urlencode "cmnd=CurrentSet 8695"  # mA = W / V * 1000
```

Until that is done the watt figures track load correctly but the absolute scale is wrong.

### The old model

Kept as `homelab:power_wall_watts:model`, and `homelab:power_wall_watts:estimate` falls back to
it whenever the plug scrape fails, so the dashboard never goes blank:

```
wall_watts = (package_watts + 10) / 0.89
```

`node_hwmon_power_watt` on the `amdgpu` chip is PPT — CPU cores and iGPU only. It misses the
NVMe drive, the DIMMs, the 2.5G NIC, the fan, the board, and the loss in the external brick.
The `+10 W` offset and `/0.89` brick efficiency add those back. Both constants live in the
`homelab-power` rule group. `SmartPlugDown` fires when the fallback is in use for 5 minutes.

RAPL is a dead end here: `/sys/class/powercap/intel-rapl:0/energy_uj` is root-only since the
PLATYPUS mitigation, and the collector returns nothing even running as root.

## Dashboard

`Homelab Overview`, set as the Grafana home dashboard.

Wall power, package power, kWh/day and €/month across the top; then power draw over time, CPU
per core, memory, `enp3s0` throughput, temperatures, per-container CPU and memory, `enp3s0` errors
and link flaps, disk, and host uptime/load.

### Reading the memory panels

**Memory** (host) plots `used` as `MemTotal - MemAvailable`, so reclaimable page cache is already
excluded — that line is the real pressure. `cache + buffers` is free RAM the kernel is borrowing
and hands straight back. `swap used` is plotted alongside: if it climbs while `used` stays low,
`vm.swappiness` is evicting cold pages for no reason.

**Container memory (RSS)** uses `container_memory_rss`, not `container_memory_working_set_bytes`.
Working set counts the kernel's page cache against whichever container caused the I/O, so
qbittorrent reads as 2.5 GiB when its cgroup is `anon 11 MB` / `file 25 GB` — all of it
reclaimable cache. RSS is the memory a container actually owns, so the panel now ranks by
something worth acting on. The cache is not lost from view; it is the `cache + buffers` line on
the host panel.

The `cost_per_kwh` dashboard variable defaults to **0.27 EUR** — change it at the top of the
dashboard. See below for where that number comes from.

## Cost per kWh

Derived from the Edison contract renewal (*Edison Dynamic Luce*, valid 23/07/2026 – 22/07/2027). It is a **PUN-indexed variable** tariff, so there is no headline price
to copy; the number has to be reconstructed.

What the dashboard needs is the **marginal** cost — what one more kWh from the box actually
costs. The 99 €/POD/year standing charge is paid whether the box runs or not, so it must stay
out of the rate, otherwise the €/month panel double-counts it.

The cleanest source is the *slope* of Edison's own annual-spend table (monorario, 3 kW,
abitazione di residenza), which already includes energy, dispatching, transport and system
charges, and excludes taxes and the fixed fee:

| Consumption | Annual spend (excl. tax) | Marginal |
|---|---|---|
| 1.500 kWh | 514,28 € | |
| 2.200 kWh | 663,55 € | 0,21324 €/kWh |
| 2.700 kWh | 773,92 € | 0,22074 €/kWh |
| 3.200 kWh | 884,29 € | 0,22074 €/kWh |

The slope steps by exactly **0,00750 €/kWh** at 2.200 kWh/year, which is precisely the
contract's B−A spread (0,0355 − 0,0280). That the two agree to the fifth decimal is the check
that the table is being read correctly.

A 24/7 server pushes the household past 2.200 kWh/year, so its own kWh are marginal in the
**B band**. Adding the taxes the table excludes:

```
(0,22074 + 0,0227 accisa) × 1,10 IVA = 0,2678 €/kWh
```

- **accisa** 0,0227 €/kWh — domestic excise beyond the exempt tier
- **IVA** 10% — domestic electricity rate

**Rounded to 0,27 €/kWh.**

### Monorario or multiorario does not matter here

The contract offers both. Weighting February 2026 PUN by the ARERA band hours for a load that
never sleeps (F1 55 h/week, F2 41 h, F3 72 h):

```
(0,13451×55 + 0,13182×41 + 0,11583×72) / 168 = 0,12585 €/kWh
```

Identical to the monorario F0 of 0,12585. A flat 24/7 load lands on the average by definition,
so the two options are worth the same for this box. Edison's table shows multiorario very
slightly *dearer* (0,22256 vs 0,22074 marginal), but that reflects the Portale Offerte's
standard household profile, not a server.

### Range

PUN moves monthly, so the rate does too. At the highest PUN in the preceding 12 months
(F0 0,14593 in January 2026, vs 0,12585 in February) the same calculation gives **0,29 €/kWh**.
Treat 0,27 as the centre of a roughly 0,26–0,29 band and revisit when the contract renews in
July 2027.

### Assumptions worth checking

The table has entries for several supply tiers; this uses **3 kW, abitazione di residenza**,
the fullest and most common one. On a 4,5 kW or 6 kW supply, or a *non di residenza* contract,
the marginal energy rate barely moves but the accisa treatment differs — the exempt tier is a
residence benefit.

## Alerts

Rules are defined in Prometheus but there is no Alertmanager yet, so they fire into nothing.
They are visible under Grafana → Alerting → Prometheus rules.

`HostDown`, `EthernetLinkFlapping`, `EthernetErrors`, `MemoryPressure`, `DiskFillingUp`,
`CPUHot`, `SmartPlugDown`. `HostDown` and `EthernetLinkFlapping` exist because of the September 2026 suspend
problem — if the box ever goes to sleep again, this is what notices.

`MemoryPressure` and `DiskFillingUp` carry an explicit `instance="homelab"` for the same reason
the dashboard does: the NAS reports the same metric names.

The NAS has its own group: `NasDown`, `NasPoolFillingUp`, `NasRaidDegraded`, `NasDiskHot`.
`NasPoolFillingUp` sits close to firing by design — `/volume1` is at 82 % and only gets fuller.

Add Alertmanager, or wire Grafana's own alerting to a notification channel, to actually get
told.
