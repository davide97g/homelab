# Cinema

A custom web front-end for [Jellyfin](https://jellyfin.org). React + Vite +
[duck/ui](https://duckui.davideghiotto.it), talking to an unmodified Jellyfin
server over its REST API.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for how it works and why.

## Quickstart

```bash
cp .env.example .env    # paths + JELLYFIN_URL
bun install
bun run dev:all         # Jellyfin (Docker) + http://localhost:5173
```

Sign in with your Jellyfin username and password.

`dev:all` ([`scripts/dev.sh`](./scripts/dev.sh)) is the whole stack in one
command: it brings the Jellyfin container up, waits for its API, then starts
Vite. `bun run dev` alone is still the front end on its own, against a Jellyfin
you started yourself. Ctrl+C stops Vite and leaves the container running —
`docker stop jellyfin` for that.

## Films on an external drive

Two libraries, two mounts:

| Library | Mount | Source |
|---|---|---|
| Movies | `/media` | `LOCAL_MEDIA_PATH`, the folder on this machine |
| Toshiba | `/mnt/toshiba` | `DRIVE_MEDIA_PATH`, the removable drive |

Mount the drive read-only at its own root — not nested inside another read-only
mount, which Docker refuses — and lay the films out as
`Film Name (Year)/Film Name (Year).mkv`.

### With the drive unplugged

`dev:all` decides the mount set at startup and skips the drive when its host
path is gone, so the stack comes up on the local folder alone. Without that,
Docker refuses to start the container at all:

```
error while creating mount source path '/host_mnt/Volumes/Untitled':
mkdir /host_mnt/Volumes/Untitled: permission denied
```

Mounts cannot be added to a live container, so the script recreates it when the
set changed. Nothing is lost: `/config` and `/cache` are named volumes, so the
library, users and metadata all survive. Plug the drive back in and re-run
`bun run dev:all` to pick it up.

The drive's films still appear while it is away — Jellyfin serves metadata from
its own database, so it never notices, and keeps claiming the film is directly
playable. The app checks for itself with a one-byte range request and shows an
offline state instead of a Play button. See
**[ARCHITECTURE.md § 7](./ARCHITECTURE.md)**.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev:all` | Jellyfin container + dev server, one command |
| `bun run dev` | Dev server only, with the `/jf` → Jellyfin proxy |
| `bun run build` | Typecheck + production build to `dist/` |
| `bun run preview` | Serve the production build |

## Theming

Everything lives in `src/index.css`. Change `--primary` to change the app's
personality. Tokens follow shadcn/ui naming on top of duck/ui's dark-first set,
so both `bunx shadcn@latest add <x>` and `bunx shadcn@latest add @duck/<x>`
drop in and inherit the theme.

The app is dark-only: `<html>` carries `class="dark"` permanently, which is
where duck/ui keeps its dark tokens.

duck/ui's own rules — one holo element per viewport, one idle animation, lime
for every default action, 3px sticker borders — are restated at the top of
`src/index.css`. Read them before adding UI.

The gaps this app found in duck/ui — five missing components and four bugs —
are written up in the duck/ui repo as `docs/feature-requests/media-app-gaps.md`.
All of them have shipped, so nothing here is patched locally any more.

One thing stays a consumer override: the theme ships `--font-sans` and
`--font-display` with a system fallback stack, so the two lines in
`src/index.css` that opt into Bricolage Grotesque + Geist have to be re-applied
after any `shadcn add @duck/…` that pulls the theme in. duck/ui documents this
at `/docs/theming#type`.

## Stack

- **@jellyfin/sdk** — typed API client. Note its `getBrowserDeviceProfile()`
  is unusable (returns only `SubtitleProfiles`); `src/lib/jellyfin/device-profile.ts`
  builds a real one by probing the browser
- **TanStack Query** — all server state
- **React Router** — routing
- **hls.js** — HLS playback when the server transcodes
- **Tailwind v4 + duck/ui** — design system
