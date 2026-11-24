# site

`homelab.davideghiotto.it` — the homelab explained to people who are not into networking: the two
boxes, how a request reaches home, the apps (Cinema, Memories, Cassette, Accounts) with screenshots,
previews and example flows, then a contact call to action. Italian, Apple-like light theme (system
font, brand colours of each app on tinted panels), no build step.

| | |
|---|---|
| Source | `public/`: `index.html`, `assets/site.css`, `assets/site.js`, fonts, screenshots |
| Host | mini PC, plain compose in `~/homelab-site` (project `homelab-site`, container `homelab-site-web`) |
| Server | `nginx:1.30.8-alpine`, read-only, default `bridge`, `127.0.0.1:8803` |
| Tunnel | mini PC tunnel, `homelab.davideghiotto.it` -> `http://localhost:8803`. Not behind Access |

Screenshots are real, taken 2026-11-23 with agent-browser signed in through accounts: Cinema web
(1600x900), Cassette web and the Memories web client run locally against the real Immich (iPhone 16 Pro
emulation, resized with `cwebp -q 82 -resize 640 0`). Memories photos are blurred at the source: a
`filter: blur(18px)` style was injected before each capture, and the location label was hidden, so the
published files never held sharp photos. The Accounts screen is an HTML preview in the accounts app's own
dark tokens. Icons are Phosphor 2.1.1, inlined as an SVG sprite. Inter Tight (copied from cassette's
site) is only the fallback where the system font is not SF Pro.

Preview: `python3 -m http.server -d public 8813`. Release: `deploy/deploy.sh` (rsync, nginx reload). Bump `?v=` on the CSS/JS links when they change: they are cached a day.
No CI.
