# Web apps on the mini PC

The detail behind the table in the root [README](../README.md#web-apps): how each public web app is
built, published and released, in the order they arrived. Moved out of the README on 2026-11-23,
unchanged except where noted. The tunnel rules themselves are in
[`cloudflare/tunnels.json`](../cloudflare/tunnels.json).

Web apps run as Dokploy apps, each published on the tunnel and deployed by its own CI rather
than by Dokploy's auto-deploy — `calorico.davideghiotto.it`, `thumb.davideghiotto.it`,
`ral-api.davideghiotto.it` and `wedding.davideghiotto.it` (with its guest-list dashboard on
`wedding-admin.davideghiotto.it`) today, all four moved here off a Hetzner VPS on 2026-09-15,
which emptied it. `maestro.davideghiotto.it` ([repo](https://github.com/davide97g/maestro)) was
built here on 2026-09-17 rather than ported: a compose app, SQLite on the `maestro-data` volume,
no CI yet, so it is released with one `compose.deploy` call. It carries an LLM API key, so it has
its own email/password login (Better Auth, self-hosted) and registration is invite-only —
`SIGNUP_MODE`/`SIGNUP_CODE` in its Dokploy environment. It is not behind Access. All are **compose** apps except ral-gate, a Dockerfile **application**,
which changes the API endpoints but nothing else.
`buriko.davideghiotto.it` is the landing page for [buriko](https://github.com/davide97g/brick), added
2026-09-30: a compose app (`buriko-pv8lun`, compose path `./site/compose.yml`) building an nginx
image of the static `site/public/`. No CI and no deploy hostname; after a push to that repo's `main`
it is released with one `compose.deploy` call.
`autocratico.davideghiotto.it` is [autocratico](https://github.com/davide97g/autocratico), the
personal paperwork register, added 2026-10-03: a compose app (`autocratico-3sar53`, compose path
`./deploy/compose.homelab.yml`) bound to `127.0.0.1:8790` and published straight from the tunnel,
no Traefik domain. **Behind Access** (app `autocratico`: `email-access` plus a service-token policy
`autocratico-shortcut` for the iOS share-sheet shortcut), and the server also checks the Access JWT
and its own paired-device tokens. Data is a bind mount of `~/autocratico/data` (plain files plus a
local git history), nightly tarballs in `~/backups/autocratico`. The container runs headless
Claude Code (`CLAUDE_CODE_OAUTH_TOKEN`) and the `@autocratico_bot` Telegram bot by long polling.
No CI; released with one `compose.deploy` call. Runbook: that repo's `docs/deploy-homelab.md`.
`get-autocratico.davideghiotto.it` is autocratico's public landing page, added 2026-10-03: a second
compose app in the same project (`autocratico-site-msw6em`, compose path `./deploy/compose.site.yml`),
nginx serving the static `apps/site` build on `127.0.0.1:8791`, tunnel straight to it, no Traefik
domain, **not** behind Access. No CI; released with one `compose.deploy` call.
`echo.davideghiotto.it` is the public voice-clone demo of [echo](https://github.com/davide97g/echo),
added 2026-10-12: compose app `echo-demo-qxdnww` in project `echo`, compose path `./demo/compose.yml`,
branch `demo-site`. One container (FastAPI + Qwen3-TTS 0.6B and Whisper on CPU, capped at 8 CPUs and
6 GB) on `127.0.0.1:8795`, tunnel straight to it, no Traefik domain, **not** behind Access. Data is a
bind mount of `~/echo-demo` (mode 700): Davide's reference clip (biometric, copied by hand, never in
git), rendered lines and the ~3 GB model cache. Visitor recordings are never written to disk. No CI;
released with one `compose.deploy` call (`DOKPLOY_COMPOSE_ID_ECHO_DEMO` in `.env`). Runbook: that
repo's `demo/README.md`.
`slowgram.davideghiotto.it` is the landing page (plus `/privacy/` and `/support/` for the App Store
listing) of [Slowgram](https://github.com/davide97g/slowgram), added 2026-10-24: compose app
`slowgram-site-a3rjn4` in project `slowgram`, compose path `./site/compose.yml`, built like buriko's —
nginx image of the static `site/public/`, Dokploy domain on service `web` port 80, tunnel to
`http://localhost:80`. Private repo, visible to the Dokploy GitHub app. Not behind Access. No CI; a
release is one `compose.deploy` call (`DOKPLOY_COMPOSE_ID_SLOWGRAM_SITE` in `.env`).
`aftergrowth.davideghiotto.it` is [Aftergrowth](https://github.com/davide97g/aftergrowth), the cozy
sky-island witch game, added 2026-10-25: compose app `aftergrowth-wxf9t7` in project `aftergrowth`,
compose path `./deploy/compose.yml`. One Node container (the built game plus the WebSocket island hub
on `/net`), service `aftergrowth` port 8787 behind a Dokploy domain, tunnel to `http://localhost:80`.
Public repo, not behind Access: players are anonymous browser identities. State is one JSON file on
the `aftergrowth-data` volume. CI deploys through `deploy-aftergrowth.davideghiotto.it`
(`api/compose\.(deploy|one)` only). Runbook: that repo's `deploy/README.md`.
`touchgrass.davideghiotto.it` is [touchgrass](https://github.com/davide97g/touchgrass), the anime grassland walk in WebGL,
added 2026-11-06: **not** a Dokploy app — a static site needs no build pipeline here. Plain compose in
`~/touchgrass` (project `touchgrass`, container `touchgrass-web`, `nginx:1.30.6-alpine`, read-only) bound
to `127.0.0.1:8796`, tunnel straight to it, no Traefik domain, not behind Access. It sits on Docker's
default `bridge` because creating a network failed with *all predefined address pools have been fully
subnetted* — worth fixing (`default-address-pools` in `daemon.json`) before the next stack needs one — fixed
2026-11-22 with a `10.200.0.0/16` pool, so new stacks can have their own networks again.
The site is a read-only bind mount of `~/touchgrass/site`; a release is that repo's `deploy/deploy.sh`
(build on the Mac, `rsync --delay-updates`, nginx reload). No CI.
`mirai.davideghiotto.it` is a website proposal for Mirai Sushi (Montecchio Maggiore), added
2026-11-10, repo `~/personal/projects/mirai` (local only, not on GitHub yet). Built like touchgrass: plain
compose in `~/mirai` (project `mirai`, container `mirai-web`, `nginx:1.30.6-alpine`, read-only, default
`bridge`) bound to `127.0.0.1:8797`, tunnel straight to it, not behind Access, `noindex` until the
restaurant approves. A release is that repo's `deploy/deploy.sh` (build on the Mac, rsync, nginx reload).
`isoworld.davideghiotto.it` is the landing page of [isoworld](https://github.com/davide97g/isoworld),
the pixel-art farming game, added 2026-11-16 (full game on itch.io; the page frames a short guided
taster, `play.html?taster`). Built like touchgrass: plain compose in `~/isoworld` (project `isoworld`,
container `isoworld-web`, `nginx:1.30.6-alpine`, read-only, default `bridge`) bound to
`127.0.0.1:8798`, tunnel straight to it, not behind Access. A release is that repo's
`deploy/deploy.sh` (build on the Mac, rsync, nginx reload). No CI.
`nimbus.davideghiotto.it` is a website proposal for Nimbus Pub (Vicenza), added 2026-11-17, repo
`~/personal/projects/nimbus` (Astro, local only). Built like touchgrass: plain compose in `~/nimbus`
(project `nimbus`, container `nimbus-web`, `nginx:1.30.6-alpine`, read-only, default `bridge`) bound to
`127.0.0.1:8799`, tunnel straight to it, not behind Access, `noindex` (preview build) until the pub
approves. A release is that repo's `deploy/deploy.sh` (build on the Mac, rsync, nginx reload). No CI.
Since 2026-11-17 it also runs `nimbus-api` (`node:24.22.2-alpine`, `server/index.mjs`, no deps) in
`nimbus-web`'s network namespace (`network_mode: service:web`, no new subnet): nginx proxies `/api/` to
`127.0.0.1:8787`. It stores personalised-card requests (SQLite + photos) in `~/nimbus/data`, read at
`/admin` with the password in `~/nimbus/.env` (`ADMIN_PASSWORD`, mode 600, not in the repo). Back up
`~/nimbus/data` if the pub starts using it for real.
`ciamioncino.davideghiotto.it` is [Ciamioncino](https://github.com/davide97g/ciamioncino), the cozy
off-road driving game (Godot 4.7 web build + online multiplayer), added 2026-11-18. Built like nimbus:
plain compose in `~/ciamioncino` (project `ciamioncino`): `ciamioncino-web` (`nginx:1.30.6-alpine`,
read-only, default `bridge`) bound to `127.0.0.1:8800`, tunnel straight to it, not behind Access, and
`ciamioncino-game` (Godot 4.7.2 headless relay, image built on the box from `~/ciamioncino/server`) in
nginx's network namespace (`network_mode: service:web`); nginx proxies `/ws` (WebSocket) to
`127.0.0.1:9080`. No data. A release is that repo's `deploy/deploy.sh`. No CI.
`zootycoon.davideghiotto.it` is Zoolandia ([repo](https://github.com/davide97g/zoolandia), private),
the zoo management game (Godot 4.7 web build), added 2026-11-21: compose app `zoolandia-xr8c3b`
(composeId `WyPIzGNDoNoUeMU3Kis36`) in project `zoolandia`, compose path `./deploy/compose.yml`,
branch `main`. The image builds the Godot web export itself (`deploy/Dockerfile`: Godot editor and
web template fetched once, kept in the layer cache) and serves it with nginx on `127.0.0.1:8801`,
default `bridge`, tunnel straight to it, no Traefik domain, not behind Access. No data. **Push to
`main` deploys**: the repo's `.github/workflows/deploy.yml` calls `compose.deploy` through
`deploy-zootycoon.davideghiotto.it` (`api/compose\.(deploy|one)` only) and waits for Dokploy.
`videogiochi.davideghiotto.it` is the landing page of Davide's game remakes, added 2026-11-23, repo
`~/personal/projects/videogiochi` (Astro, local only). Plain compose in `~/videogiochi`: one
`nginx:1.30.6-alpine` (read-only, default `bridge`) serving the static build on `127.0.0.1:8802`,
tunnel straight to it, not behind Access. No data. A release is that repo's `deploy/deploy.sh`
(build on the Mac, rsync, nginx reload). No CI.
`homelab.davideghiotto.it` is this homelab's own landing page ([`apps/site`](apps/site/)), added
2026-11-23: what is connected, for people who are not into networking. Built like touchgrass: plain
compose in `~/homelab-site` (project `homelab-site`, container `homelab-site-web`, `nginx:1.30.6-alpine`,
read-only, default `bridge`) bound to `127.0.0.1:8803`, tunnel straight to it, not behind Access. No data,
no build. A release is `apps/site/deploy/deploy.sh` (rsync, nginx reload). No CI.
`lumii.davideghiotto.it` is LUMII Montecchio's restaurant app (`apps/lumii-*` in
[zeroshot](https://github.com/davide97g/zeroshot)), added 2026-11-06: compose app `lumii-grjqvu`
(composeId `uarKwudQqkZPe_cue7rqe`) in project `lumii`, compose path `./docker-compose.lumii.yml`,
branch `main`. App + Postgres 18 + nightly `pg_dump` (volume
`lumii-backups`, 14 days). Dokploy domain on service `lumii-app` port 3000, tunnel to
`http://localhost:80`, not behind Access (customers sign in by email code). Its compose network
has an explicit subnet (`LUMII_SUBNET`, default `10.213.0.0/24`) because Docker's address pools
are used up here (see touchgrass above). Secrets in its Dokploy Environment tab. No CI; a release
is one `compose.deploy` call.
`atlante.davideghiotto.it` is the backend for [Atlante](https://github.com/davide97g/atlante),
the self-hosted maps app, built here on 2026-09-19 rather than ported. A compose app: Fastify API,
PostGIS with the Italy OSM index, Valhalla and Martin. The heavy artefacts — the PMTiles basemap
and the Valhalla routing graph, ~4 GB — are built on the Mac and rsynced to `~/atlante/`, which is
bind-mounted; nothing large is ever built on this box. Its own
[`DEPLOY.md`](https://github.com/davide97g/atlante/blob/main/DEPLOY.md) is the runbook. Not behind
Access: a native iOS client cannot pass an Access challenge, so Clerk bearer tokens are the gate
and every route except `/health` requires one. No CI yet — released with one `compose.deploy` call.

