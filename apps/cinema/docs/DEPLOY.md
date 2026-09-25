# Deploying Cinema

Cinema runs **on the NAS**, in the same box as the Jellyfin it talks to, and is published on the
NAS's own Cloudflare tunnel. It is not a Dokploy app on the mini PC — putting it there would
have sent every stream across the network for no reason, and the mini PC is not on the same LAN
as the NAS anyway (same subnet numbering, different network; only Tailscale connects them).

The mini PC used to run a second Jellyfin, on `streaming.davideghiotto.it`. That hostname is
gone as of 2026-09-19, but the server itself came back the same day, LAN-only — see
[A second copy, on the mini PC](#a-second-copy-on-the-mini-pc) below.

Live at **<https://cinema.davideghiotto.it>** since 2026-09-17.

Identifiers below are placeholders: `<tunnel-uuid>` and `<nas-lan-ip>` are properties of one
homelab and are of no use to anyone else. Substitute your own.

## The shape of it

| | |
|---|---|
| Host | UGREEN NAS, reached over Tailscale as `ssh nas`, as a user in the `docker` group |
| Container | `cinema-web`, from `services/web/compose.yaml`, published on `:8898` |
| Jellyfin | same box, `:8899`, container `jellyfin-app-1` |
| Tunnel | the NAS's own Cloudflare tunnel, `<tunnel-uuid>` |
| DNS | proxied CNAME `cinema` → `<tunnel-uuid>.cfargotunnel.com` |

The mobile apps are excluded: the web image needs `apps/web` and `packages/`, and shipping 38 MB
of Swift and Kotlin to the NAS on every deploy would buy nothing.

`apps/web/Dockerfile` builds the SPA with Bun and serves it from nginx, which also proxies
`/jf/` to Jellyfin. Same-origin in production for the same reason it is same-origin in
development: no CORS, and byte-range video requests pass through untouched. `proxy_buffering off`
is what keeps seeking responsive.

**Ports.** `80` is UGOS's own web server and `8899` is Jellyfin, so Cinema took `8898`.

**Upstream.** Jellyfin sits on Docker's default bridge with no DNS alias, so nginx cannot reach
it by name; it goes through the bridge gateway, `http://172.17.0.1:8899`.

## Deploying a change

The NAS builds its own image — it is x86_64 and the Mac is not — from a copy of the source:

```sh
cd ~/personal/projects/homelab/cinema
tar czf - --exclude node_modules --exclude .git --exclude dist --exclude .env \
          --exclude 'apps/ios' --exclude 'apps/android' . \
  | ssh nas 'tar xzf - -C ~/cinema'
ssh nas 'cd ~/cinema/services/web && docker compose up -d --build'
```

`JELLYFIN_UPSTREAM` and `CINEMA_PORT` used to ride on that command. They are properties of the
NAS, not of the deploy, and a typo in either shipped a container that built, started, and proxied
to nothing — so they now live as defaults in `compose.yaml` (`172.17.0.1:8899` and `8898`). Any
other host overrides them with an `.env` beside `compose.yaml`, which the tar above will not
overwrite.

Verify on the box before trusting the public URL:

```sh
ssh nas 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8898/
         curl -s http://localhost:8898/jf/System/Info/Public | head -c 80'
```

## One hostname, two things

`jellyfin.davideghiotto.it` was removed from the tunnel and from DNS on 2026-09-17: Cinema is the
only public entrance now. Jellyfin did not move — it is served under the same hostname at `/jf`:

| What | Where |
|---|---|
| Cinema | `https://cinema.davideghiotto.it` |
| Jellyfin API, for native clients | `https://cinema.davideghiotto.it/jf` |
| Jellyfin admin UI | `https://cinema.davideghiotto.it/jf/web/` |
| Jellyfin on the LAN | `http://<nas-lan-ip>:8899` |

**Native clients take `/jf` as their server URL verbatim** — that includes Cinema for iOS, and
anything else (Swiftfin, Findroid, Infuse) pointed at the old hostname. Each one has to be
repointed once; there is no redirect, because the old name no longer resolves.

To put the old hostname back, add an ingress rule `jellyfin.davideghiotto.it` →
`http://localhost:8899` before the catch-all, and a proxied CNAME to the tunnel.

## The Cloudflare edits

Both were made with `CF_API_TOKEN` from the homelab `.env`. The tunnel config API replaces the
**whole** ingress list, so read it, edit, write it back — and keep the catch-all last or it
swallows everything after it.

```sh
cf GET  "accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations"
cf PUT  "accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations"
cf POST "zones/$CF_ZONE_ID/dns_records"   # proxied: true, or the CNAME points at nothing
```

## A second copy, on the mini PC

`cinema.davideghiotto.it` serves the NAS, and the NAS holds only what `xfer-nas` managed to copy
before that timer was disabled for disk — ~45 GB free against a 543 GB library. The finished
downloads therefore live on the mini PC, and since 2026-09-19 a second Jellyfin and a second
`cinema-web` run there to play them, published on the mini PC's own tunnel as
`home-cinema.davideghiotto.it`.

| | |
|---|---|
| Cinema | `https://home-cinema.davideghiotto.it`, or `http://debian:8898` on the LAN |
| Jellyfin | `http://debian:8097`, or `http://debian:8898/jf/web/` |
| Jellyfin service | the `jellyfin` service in `~/mediarr/compose.yml`, not a separate stack |
| Upstream | `http://172.17.0.1:8097` — bridge gateway, because the two live in different compose projects |

Jellyfin is on **8097**, not 8096: `jellyfin-proxy` still holds 8096 on that box, and Jellyseerr,
hub, mediarr-dash and jarvis all mean the NAS's server when they say it. It reuses the
`mediarr_jellyfin-config` and `mediarr_jellyfin-cache` volumes the retired local server left, so
its users, watch state and libraries came back as they were; the volumes were root-owned and had
to be `chown`ed to `1000:1000` for the container's non-root user, which otherwise dies at startup
with `SQLite Error 8: attempt to write a readonly database`.

This copy deploys itself: a push to `main` that touches `apps/cinema` (outside the iOS and Android
forks) runs `.github/workflows/cinema.yml`, and Dokploy's app `web-1pwofz` on the mini PC builds it from the
repo. The NAS copy above is still the tar by hand: Dokploy cannot reach the NAS. The mini PC's
two per-host values live in that app's Dokploy Environment tab:

```sh
JELLYFIN_UPSTREAM=http://172.17.0.1:8097
CINEMA_PORT=8898
```

### Its hostname and its gate

**`home-cinema.davideghiotto.it`, not `home.cinema.davideghiotto.it`.** Universal SSL covers
`davideghiotto.it` and `*.davideghiotto.it` and stops there — a second label deep needs Advanced
Certificate Manager or Total TLS, so a name like `home.cinema.…` serves a certificate error on a
zone without one.

**Behind Cloudflare Access**, app `cinema (home)`, one `allow` policy on the same email address
every other app here uses, 720h sessions. The mini PC's Jellyfin has a deliberately trivial
admin password for LAN use, so the edge is what actually guards it. Two consequences:

- `/jf` is behind the challenge too, so **native clients cannot use this hostname** — Swiftfin,
  Findroid and Infuse have no way to answer it. They stay on `http://debian:8097` over the LAN,
  or on `cinema.davideghiotto.it/jf` for the NAS's library.
- Loosening the Jellyfin password without first removing Access, or removing Access without
  first fixing the password, each leave an admin account named `root` reachable from the
  internet.

```sh
cf PUT  "accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations"  # ingress -> http://localhost:8898
cf POST "zones/$CF_ZONE_ID/dns_records"                                    # proxied CNAME
cf POST "accounts/$CF_ACCOUNT_ID/access/apps"                              # + one email policy
```
