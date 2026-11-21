# Memories

Public door for the NAS's Immich. Live at **<https://memories.davideghiotto.it>** since 2026-11-10.
Before that, Immich was reachable only on the LAN and over Tailscale.

| What | Where |
|---|---|
| Immich web UI | `https://memories.davideghiotto.it` |
| Immich server URL, for the native apps | `https://memories.davideghiotto.it/immich` |
| Immich on the LAN / Tailscale | `http://<nas-ip>:2283` |

Same idea as Cinema's `/jf`: one hostname, the native apps get their own prefix. Unlike Cinema,
the root is Immich's own web UI, not a custom front end.

## The shape of it

| | |
|---|---|
| Host | UGREEN NAS, `ssh nas` |
| Immich | stock compose in `/volume1/docker/immich-app` (project `immich`), `immich_server` on `:2283` — untouched |
| Proxy | `memories-proxy` (nginx), from `compose.yaml` here, on `127.0.0.1:2284`, joined to `immich_default` |
| Tunnel | `nas-ilario` (the NAS's own, same as Cinema), ingress `memories.davideghiotto.it` -> `http://localhost:2284` |
| DNS | proxied CNAME `memories` -> `<nas-tunnel-uuid>.cfargotunnel.com` |

**Why an nginx at all.** Immich has no base-path setting, and cloudflared cannot rewrite paths,
so `/immich/` is stripped here. The mobile app copes: it reads `<server>/.well-known/immich`,
gets `{"api":{"endpoint":"/api"}}`, appends it to the URL it was given, and opens its websocket
under the same prefix.

**Loopback only.** cloudflared runs on the host, so the proxy binds `127.0.0.1`. The LAN keeps
`:2283`.

## Deploying a change

```sh
cd ~/personal/projects/homelab/apps/memories
tar czf - compose.yaml nginx.conf | ssh nas 'mkdir -p ~/memories && tar xzf - -C ~/memories'
ssh nas 'cd ~/memories && docker compose up -d --force-recreate'
```

Verify on the box, then from outside:

```sh
ssh nas 'curl -s http://127.0.0.1:2284/immich/api/server/ping'   # {"res":"pong"}
curl -s https://memories.davideghiotto.it/immich/.well-known/immich
```

`~/memories` lives in `/home/davide`, which a UGOS update can wipe (it did on 2026-11-08). If
`memories-proxy` is gone after an update, redeploy with the commands above.

## Things to know

- **100 MB per request.** Cloudflare's free plan rejects any single upload above 100 MB with a
  413. Photos are fine; long videos from the phone are not. In the app, *Settings > Networking >
  Automatic URL switching*: home Wi-Fi SSID -> `http://<nas-ip>:2283`, external ->
  `https://memories.davideghiotto.it/immich`. Big videos then back up at home.
- **Share links.** *Administration > Settings > Server > External domain* =
  `https://memories.davideghiotto.it`, or links point at the LAN address.
- **It is on the Internet now.** Only Immich's login stands in front. Strong passwords, no
  public sign-up (Immich has none unless OAuth auto-register is on).

## Undo

Remove the ingress rule from `nas-ilario` (read the config, drop the rule, PUT it back — the
API replaces the whole list), delete the `memories` CNAME, then
`ssh nas 'cd ~/memories && docker compose down'`.
