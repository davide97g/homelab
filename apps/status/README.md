# Status page: status.davideghiotto.it

Public page, in the style of a status page, for the homelab's public services: what works now and
day-by-day uptime over the last 90 days. Added 2026-11-23.

It does **not** run on the homelab. If it did, it would vanish exactly when it is needed.

```
blackbox-exporter (mini PC, apps/monitoring)   every 60 s, GET each public URL through Cloudflare
        │  Prometheus job blackbox-public
publisher (mini PC, user timer, every 5 min)   queries Prometheus, builds one JSON
        │  POST /api/ingest, Bearer token
Worker homelab-status (Cloudflare)             stores it in KV, serves the page and /status.json
```

When snapshots stop for 15 minutes the page turns red and says the home server is silent — that is
the box-down case, which no check running on the box can report. healthchecks.io covers the same
case for the alerts (see `apps/monitoring`, *Alerts*).

## Which services

The `blackbox-public` job in [`apps/monitoring/compose.base.yml`](../monitoring/compose.base.yml):
one `targets` entry per service, with `service` (name shown) and `group` (Media, AI, Giochi, App,
Siti). Add or remove a line there, deploy monitoring, and the page follows within five minutes.
Only public, user-facing hostnames: no admin panels, nothing behind Access, no client proposals
(mirai, nimbus, lumii), no wedding. A probe passes on 2xx after redirects.

A day's bar is `avg_over_time(probe_success[1d])`: green ≥ 99.95 %, light green ≥ 99 %, orange
≥ 95 %, red below, grey for no data (days before 2026-11-23). Prometheus keeps 180 days, so 90 is
safe.

## Pieces

| Path | Where | What |
|---|---|---|
| `worker/worker.js`, `worker/index.html` | Cloudflare Worker `homelab-status`, KV namespace `homelab-status`, custom domain | The page (plain HTML, no build) and the ingest endpoint |
| `worker/deploy.sh` | run on the Mac | Deploys through the Cloudflare API with `CF_API_TOKEN`; first run also creates KV, the ingest token and the domain |
| `publisher/publish.py` + units | `~/ops/status/`, user timer `status-publish` | Reads Prometheus via `docker exec`, POSTs the snapshot |

The ingest token is `STATUS_INGEST_TOKEN` in the repo `.env`, `~/.config/homelab/status.env` on
the box, and the Worker secret `INGEST_TOKEN`. It can only overwrite the snapshot. The box holds
no Cloudflare token.

## Deploy

```sh
apps/status/worker/deploy.sh                                   # page or Worker changed
scp -r apps/status/publisher homelab:/tmp/status-publisher && ssh homelab 'bash /tmp/status-publisher/install.sh'
ssh homelab journalctl --user -u status-publish -n 5           # last publishes
```
