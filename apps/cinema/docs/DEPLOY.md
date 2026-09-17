# Deploying Cinema on the NAS

Same shape as every other web app on the box: a Dokploy compose app, published on the
Cloudflare tunnel, no inbound port forwarded. See the homelab README for the house rules.

## What ships

`apps/web/Dockerfile` builds the SPA with Bun and serves it from nginx, which also proxies
`/jf/` to Jellyfin. Same-origin in production for the same reason it is same-origin in dev: no
CORS, and byte-range video requests pass through untouched. `proxy_buffering off` is what keeps
seeking responsive — with buffering on, nginx races ahead of the player on every range request.

## Networking

Jellyfin runs in the `mediarr` compose project on `:8096`. `services/web/compose.yaml` joins
that project's network as an external network, so the proxy target is the container name:

```yaml
environment:
  JELLYFIN_UPSTREAM: http://jellyfin:8096
```

Check the real network name before the first deploy — compose derives it from the project
directory, and `mediarr_default` is an assumption until verified:

```sh
ssh homelab 'docker network ls | grep -i mediarr'
```

## Hostname

`jellyfin.davideghiotto.it` already points at Jellyfin itself through the tunnel. Cinema wants
its own hostname rather than taking that one over, because the Jellyfin web UI is still the
admin surface — that is where libraries, users and transcoding settings live.

1. Cloudflare Zero Trust → Tunnels → the box's tunnel → **Public Hostnames** → add
   `cinema.davideghiotto.it` → service `http://localhost:3003`.
2. Deploy the compose app in Dokploy from `services/web/compose.yaml`.
3. Access policy: same treatment as the other apps. Jellyfin authenticates its own users, but
   the login form should not be on the open internet without a reason.

Swapping the hostnames later — Cinema on `jellyfin.davideghiotto.it`, the admin UI moved to
something like `jf-admin.` — is a Cloudflare-side change only, no rebuild. Do it once the
mobile apps are pointed at a stable URL, not before: every client stores the server URL it was
signed in against.

## Checks after a deploy

```sh
curl -sI https://cinema.davideghiotto.it | head -1                    # SPA served
curl -s https://cinema.davideghiotto.it/jf/System/Info/Public | head  # proxy reaches Jellyfin
```

The second one is the whole deployment in one line: if it returns the server's public info,
the front end can authenticate and stream.
