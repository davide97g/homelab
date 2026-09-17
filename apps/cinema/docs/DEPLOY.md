# Deploying Cinema

Cinema runs **on the NAS**, in the same box as the Jellyfin it talks to, and is published on the
NAS's own Cloudflare tunnel. It is not a Dokploy app on the mini PC — that box has a different
Jellyfin (`streaming.davideghiotto.it`), and putting Cinema there would have sent every stream
across the LAN for no reason.

Live at **<https://cinema.davideghiotto.it>** since 2026-09-17.

## The shape of it

| | |
|---|---|
| Host | UGREEN NAS, `ssh nas` (Tailscale), user `davide`, in the `docker` group |
| Container | `cinema-web`, from `services/web/compose.yaml`, published on `:8898` |
| Jellyfin | same box, `:8899`, container `jellyfin-app-1` |
| Tunnel | `<tunnel-name>` (`<tunnel-uuid>`) |
| DNS | proxied CNAME `cinema` → `c5449ef2-….cfargotunnel.com` |

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
