# Memories web

A web client for the NAS's Immich (v3.4.0), styled after iOS 26 Photos. Spec and design tokens:
[`../DESIGN.md`](../DESIGN.md). API reference: [`../spec/immich-openapi-v3.4.0.json`](../spec/immich-openapi-v3.4.0.json).

React 19, Vite 8, TypeScript 6, Tailwind v4, TanStack Query, React Router 7, Lucide. Same stack as
`apps/cinema/apps/web`. Use bun.

## Run

```sh
cd apps/memories/web
bun install
bun run dev          # http://localhost:5180, /api proxied to the real Immich
bun run dev:mock     # http://localhost:5180, /api served from local fixtures (no server, no credentials)
```

| Script | What it does |
|---|---|
| `bun run dev` | Vite dev server. `/api` -> `https://memories.davideghiotto.it/immich/api` |
| `bun run dev:mock` | Same, but `/api` is answered by `mock/plugin.ts` (sign in with any email and password) |
| `bun run build` | `tsc -b && vite build` -> `dist/` |
| `bun run lint` | `oxlint src mock` |
| `bun run preview` | Serves `dist/` on :5181, with the same `/api` proxy as `dev` |

### Env

| Var | Default | Meaning |
|---|---|---|
| `IMMICH_URL` | `https://memories.davideghiotto.it/immich` | Immich server root for the dev/preview proxy (`/api` is appended). LAN: `http://<nas-ip>:2283` |
| `MEMORIES_MOCK` | unset | `1` = mock mode (what `dev:mock` sets) |

Put them in `apps/memories/web/.env.local` (gitignored) or the shell.

### Mock mode

`mock/` is a Vite middleware, loaded by `vite.config.ts` only when `MEMORIES_MOCK=1`, so it never
reaches the production bundle. It fakes the Immich v3.4.0 endpoints this client uses with a
deterministic library of ~65k assets (2012 to today), 12 albums, 12 people, on-this-day memories,
places, smart search, upload (accepts and discards the bytes) and trash. Pictures are SVG landscapes
drawn on the fly, and their thumbhashes are computed from the same scene, so the blur-up matches.
Videos have no media: the viewer shows the poster and "Can't play this video here". Edits
(favourite, delete, restore) live in memory until the server restarts.

## Deployment

The app is static files plus **one requirement: same-origin `/api` reaches Immich's API.**

- Images and video load as plain `<img src="/api/assets/{id}/thumbnail?...">` / `<video src="/api/...">`
  and are authenticated by the `immich_access_token` cookie that `POST /api/auth/login` sets. That
  only works if the page and `/api` share an origin. A cross-origin API would need a different auth
  scheme for media.
- JSON calls also send `Authorization: Bearer <token>` (the token is kept in `localStorage`).
- Serve `index.html` for unknown paths (client-side routes such as `/albums/<id>`).
- Uploads: Cloudflare's free plan caps a request at 100 MB on the public host; the Upload screen
  warns about larger files.
- `crypto.subtle` (SHA-1 for the duplicate check) needs a secure context. Over plain-http LAN the
  check is skipped and the server dedupes on its own.

Sketch for the existing `memories-proxy` nginx (not deployed; Immich keeps `/` today):

```nginx
location /api/ { proxy_pass ${IMMICH_UPSTREAM}; }          # Immich API, prefix kept
location /     { root /usr/share/nginx/memories-web; try_files $uri /index.html; }
```

## Layout

```
src/
  lib/api/        hand-written client + DTO types (only the endpoints used)
  lib/            auth context, thumbhash cache, formatting
  features/timeline/   TimelineStore (lazy month buckets), virtualized grid, Months/Years cards
  features/viewer/     full-screen viewer, info panel, favourite/delete actions
  features/search/     paginated results grid (smart + metadata search)
  routes/         Library, Collections, Search, Upload, Memories player, Album/Person/... screens
mock/             dev-only fake Immich (fixtures + SVG images)
```

How the timeline scales: `GET /timeline/buckets` gives month counts, which fix every cell's position
up front (one continuous grid, square cells, 2 px gutter), so only visible rows are rendered and
only the months near the viewport are fetched (`GET /timeline/bucket`, columnar payload, at most 4
in flight, stale requests dropped). Pinch or ctrl/cmd + wheel steps through 3/5/7/13 columns on a
phone and 5/8/12/20 on desktop, keeping the row under the fingers in place.
