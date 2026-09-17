# Cinema

A custom front end for [Jellyfin](https://jellyfin.org) — on the web, on iOS and on Android —
talking to an unmodified Jellyfin server over its REST API.

Jellyfin's own clients can be reskinned with custom CSS, but only within the markup they
already render. Cinema owns the interface instead: the server keeps doing libraries, metadata,
transcoding and playback, and every pixel in front of it is ours.

## Layout

```
apps/web                 React + Vite SPA. The reference implementation of the design.
apps/ios                 Swiftfin (MPL-2.0) fork. Bootstrap script + generated palette.
apps/android             Findroid (GPLv3) fork. Submodule, generated palette, icon script.
packages/design-tokens   tokens.json -> CSS custom properties, Swift, Kotlin.
services/jellyfin        Local Jellyfin in Docker for development.
services/web             Production image + compose for the NAS.
docs                     Architecture, design language, deployment.
```

The three clients share one palette and nothing else. `packages/design-tokens/tokens.json` is
the source of truth; `bun run tokens` regenerates the web CSS variables, `CinemaTokens.swift`
and `CinemaTokens.kt`. The generated files are committed so the mobile forks build without this
repo's toolchain, and hand-editing them is always wrong. The same command copies the Swift file
on into the iOS fork, and says nothing when that submodule is not checked out.

## Quickstart

```sh
cp .env.example .env    # paths + JELLYFIN_URL
bun install
bun run dev:all         # Jellyfin (Docker) + http://localhost:5173
```

Sign in with your Jellyfin username and password.

`dev:all` ([`services/jellyfin/dev.sh`](services/jellyfin/dev.sh)) is the whole stack in one
command: it brings the Jellyfin container up, waits for its API, then starts Vite. `bun run dev`
alone is the front end on its own, against a Jellyfin you started yourself. Ctrl+C stops Vite
and leaves the container running — `docker stop jellyfin` for that.

## Scripts

| Command | Does |
|---|---|
| `bun run dev` | Vite only, on `:5173` |
| `bun run dev:all` | Jellyfin container + Vite |
| `bun run build` | Regenerate tokens, type-check, bundle `apps/web` |
| `bun run tokens` | tokens.json → web CSS, Swift, Kotlin |
| `bun run lint` | oxlint |

## Films on an external drive

Two libraries, two mounts:

| Library | Mount | Source |
|---|---|---|
| Movies | `/media` | `LOCAL_MEDIA_PATH`, the folder on this machine |
| Toshiba | `/mnt/toshiba` | `DRIVE_MEDIA_PATH`, the removable drive |

Mount the drive read-only at its own root — not nested inside another read-only mount, which
Docker refuses — and lay the films out as `Film Name (Year)/Film Name (Year).mkv`.

### With the drive unplugged

`dev:all` decides the mount set at startup and skips the drive when its host path is gone, so
the stack comes up on the local folder alone. Without that, Docker refuses to start the
container at all:

```
error while creating mount source path '/host_mnt/Volumes/Untitled':
mkdir /host_mnt/Volumes/Untitled: permission denied
```

Mounts cannot be added to a live container, so the script recreates it when the set changed.
Nothing is lost: `/config` and `/cache` are named volumes, so the library, users and metadata
all survive. Plug the drive back in and re-run `bun run dev:all` to pick it up.

The drive's films still appear while it is away — Jellyfin serves metadata from its own
database, so it never notices, and keeps claiming the film is directly playable. The app checks
for itself with a one-byte range request and shows an offline state instead of a Play button.
See [`docs/ARCHITECTURE.md` § 5](docs/ARCHITECTURE.md).

## Not done yet

[`docs/ROADMAP.md`](docs/ROADMAP.md) is the list — what is done, what is next, and what a session
picking any of it up needs to know. The two headlines:

- **The web app is live** at <https://cinema.davideghiotto.it>, and Jellyfin sits behind it at
  `/jf`. The old `jellyfin.davideghiotto.it` no longer resolves, so anything still pointed at it
  has to be repointed by hand.
- **iOS is the palette, the home screen, the chrome and the icon.** What is left there is the
  poster rows and the other locales' copy.
- **Android carries the same band, on the phone and on the TV**, and is dark-only like the rest.
  Its poster rows are still upstream's.

## Reading on

Four documents, one job each:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the web app talks to Jellyfin and why,
  including the licensing rule that keeps the iOS app shippable.
- [`docs/DESIGN.md`](docs/DESIGN.md) — Reel, the design language, and the token pipeline that keeps
  the three clients looking like one product.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — putting it on the NAS behind the Cloudflare tunnel.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is done, what is next, and what the cleanup measured.

Each fork's own README ([`apps/ios`](apps/ios/README.md), [`apps/android`](apps/android/README.md))
carries its build, its palette sync and the traps that platform taught us.
