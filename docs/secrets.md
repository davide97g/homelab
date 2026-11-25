# Where every secret lives

Names and places only, never values. A secret is in one or more of six places:

| Short | Place | Read it with |
|---|---|---|
| **.env** | the repo's gitignored `.env` on the Mac (keys in [`.env.example`](../.env.example)) | `grep KEY .env` |
| **KC** | Mac Keychain, by service name | `security find-generic-password -s <service> -w` |
| **box** | `~/.config/homelab/<file>` on the mini PC, 600 | `ssh homelab cat ~/.config/homelab/<file>` |
| **Dokploy** | an app's Environment tab (written to `.env` beside its compose file) | Dokploy UI, `http://debian:3000` |
| **GH** | GitHub repository secrets of `davide97g/homelab` | `gh secret list` (names only) |
| **NAS** | a `.env` beside a compose file on the NAS, 600 | `ssh nas cat /volume1/docker/<app>/.env` |

When rotating one, change **every** copy in its row, then redeploy what reads it.

## Backups: lose these and the backups are noise

| Secret | Copies | Notes |
|---|---|---|
| restic password, box repo | box `restic-password`, `restic.env` · KC `homelab-restic` · .env `RESTIC_PASSWORD` | |
| restic password, NAS repo | box `nas-restic.env` · KC `homelab-nas-restic` · .env `NAS_RESTIC_PASSWORD` | |

Every copy of the two restic passwords sits on the box or the Mac. If both go, so do the
backups: **keep both passwords in a password manager** as well.

## Infrastructure

| Secret | Copies | Used by |
|---|---|---|
| Dokploy API key | .env `DOKPLOY_API_KEY` · GH `DOKPLOY_API_KEY` · Dokploy hub `DOKPLOY_API_KEY` | CI deploys, hub's Dokploy panel |
| Dokploy compose IDs | GH `DOKPLOY_COMPOSE_ID_<APP>` | CI deploys (identifiers, not secret, but kept out of the public repo) |
| Cloudflare API token (tunnels, DNS, Access) | .env `CF_API_TOKEN` | `tools/cloudflare`, `setup-deploy-verify.sh` |
| Cloudflare DNS token for ACME | only the `dokploy-traefik` container env `CF_DNS_API_TOKEN` | Traefik certificates; change it from Dokploy, never by removing the container |
| Access service token `github-deploy-verify` | GH `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` · KC `homelab-cf-deploy-verify` | CI's post-deploy verification |
| Access service token `nas-alloy` | NAS `nas-agents/.env` | Alloy pushing NAS logs to `loki-push` |
| Access service token `autocratico-shortcut` | KC `autocratico-cf-access-client-id`, `-secret` | the iOS shortcut |
| Hub checks bearer | Dokploy hub `CHECKS_TOKEN` · GH `HUB_CHECKS_TOKEN` · KC `homelab-hub-checks-token` | `/api/checks` from CI |
| Hub login, session secret | Dokploy hub `HUB_PASSWORD`, `SESSION_SECRET` | the hub |
| Telegram alert bot | Dokploy monitoring `ALERT_TELEGRAM_BOT_TOKEN`, `_CHAT_ID` · Seerr's Telegram agent (same bot) | Alertmanager, Seerr |
| Healthchecks.io | .env `HEALTHCHECKS_*` · box `healthchecks.env` · KC `healthchecks-api` · Dokploy monitoring `HEALTHCHECKS_PING_URL` | dead-man switch |
| Status page ingest | .env `STATUS_*` · box `status.env` · the Worker's secret | `status-publish` timer |
| FRITZ!Box | box `fritzbox-admin.env`, `fritzbox-hub.env` · KC `fritzbox-admin`, `fritzbox-hub-dns` · Dokploy hub `FRITZ_USER`, `FRITZ_PASS` | hub DNS failover |
| AdGuard admin | box `adguard.env` | AdGuard UI and API |
| ProtonVPN WireGuard key | Dokploy mediarr `WIREGUARD_PRIVATE_KEY` | gluetun |
| Grafana admin | Dokploy monitoring `GRAFANA_ADMIN_PASSWORD` | |
| *arr, Jellyfin, Seerr, Kavita, gluetun API keys | Dokploy hub `*_API_KEY` · .env `JELLYFIN_NAS_*` · Dokploy jarvis-server `JELLYFIN_TOKEN` | hub panels, JARVIS |
| NAS login | .env `NAS_PASSWORD` | ssh is key-only from the box; the Mac still has a password |

## NAS apps

| App | Secrets | Notes |
|---|---|---|
| accounts | NAS `accounts/.env`: Postgres, `BROKER_KEY`, upstream Jellyfin/Immich keys, Resend key | **back up `BROKER_KEY` off the NAS**: without it every linked account must be re-linked |
| memories | none of its own (an optional `search.env`) | |
| Immich | NAS `immich-app/.env` `DB_PASSWORD` | Ilario's install |

## Everything else

Each other app on the box (calorico, lumii, atlante, thumb-studio, contexto, …) keeps its secrets
only in its Dokploy Environment tab. List the keys, not the values:

```sh
ssh homelab 'for e in $(find /etc/dokploy/compose/*/code -maxdepth 4 -name .env -not -path "*/node_modules/*"); do echo "$e"; cut -d= -f1 "$e"; done'
```

The nightly backup includes `/etc/dokploy`, so those `.env` files are in the restic snapshots too.
