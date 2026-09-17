# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A custom front end for an **unmodified** Jellyfin server, on three clients that share one palette
and nothing else:

```
apps/web                 React 19 + Vite SPA. The reference implementation of the design.
apps/ios                 Swiftfin fork (MPL-2.0). Submodule at apps/ios/Swiftfin.
apps/android             Findroid fork (GPLv3). Submodule at apps/android/findroid.
packages/design-tokens   tokens.json -> CSS custom properties, Swift, Kotlin, Android XML.
services/jellyfin/dev.sh Local Jellyfin in Docker, the dev:all stack.
services/web             Production nginx image + compose for the NAS.
docs/                    ARCHITECTURE, DESIGN, DEPLOY, ROADMAP. Four, one job each.
```

No server fork, no plugin, no patched `jellyfin-web`. Jellyfin does metadata, users, transcoding
and bytes; this repo owns the interface.

## Commands

Bun is the package manager and script runner. The web app is built by **Vite**, not by
`Bun.serve` or HTML imports — do not migrate it.

| Command | Does |
|---|---|
| `bun install` | Workspaces: `apps/web`, `packages/*` |
| `bun run dev` | Vite only, `:5173`, against a Jellyfin you started |
| `bun run dev:all` | `services/jellyfin/dev.sh`: Jellyfin container + Vite |
| `bun run build` | `bun run tokens` then `tsc -b && vite build` in `apps/web` |
| `bun run lint` | oxlint over `apps/web/src` |
| `bun run tokens` | tokens.json → web CSS, Swift, Kotlin, XML, then syncs into both forks |

**There is no test suite.** The verification loop is `bun run build` (type-check + bundle) plus
`bun run lint`, and for behaviour, the app against a real Jellyfin. If you add tests, use
`bun test` (`bun test path/to/file.test.ts`, `-t "name"` for one case); `@types/bun` is already a
dependency.

Forks (both are git submodules — `git submodule update --init` after a fresh clone):

```sh
cd apps/ios/Swiftfin && xcodebuild -project Swiftfin.xcodeproj -scheme Swiftfin \
  -destination 'generic/platform=iOS Simulator' -skipMacroValidation build   # flag is required

export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
cd apps/android/findroid && ./gradlew :app:phone:installLibreDebug   # or :app:tv:, plus ktfmtCheck
```

Deploy is a tar over ssh to the NAS, which builds its own image — see `docs/DEPLOY.md`.

## Rules that are not visible in the code

- **Colour, radius, shadow, font and motion values live only in
  `packages/design-tokens/tokens.json`.** `bun run tokens` regenerates `apps/web/src/styles/tokens.css`,
  `apps/ios/generated/CinemaTokens.swift`, `apps/android/generated/CinemaTokens.kt` and
  `cinema_tokens.xml`, then copies them into the forks. The generated files are committed so the
  forks build without this toolchain. Never hand-edit one, and never put a hex value in a
  component — `docs/DESIGN.md` has the design rules.
- **Never move code between `apps/ios` (MPL-2.0) and `apps/android` (GPLv3).** GPL code entering
  the Swiftfin fork relicenses it, and a GPLv3 app cannot ship on the App Store. Shared logic goes
  in `packages/`, written by us, or it gets written twice. `docs/ARCHITECTURE.md` § 6.
- **Never copy code out of `jellyfin-web` (GPLv3) into `apps/web`.** Using the REST API is fine; a
  component is not.
- Keep the fork diffs small and mechanical. `git merge upstream/main` is where server-compatibility
  fixes come from, and it has to stay cheap forever.

## Web architecture (`docs/ARCHITECTURE.md` is the long version)

**Everything reaches Jellyfin through the relative base path `/jf`.** `client.ts` hands the SDK
`/jf`, so API calls, images, video byte ranges and subtitles all resolve against our own origin:
the Vite proxy forwards them in development (`apps/web/vite.config.ts`, target from `JELLYFIN_URL`
in the repo-root `.env`), nginx in production. CORS therefore never happens and `api_key` never
leaves the origin. Do not introduce an absolute Jellyfin URL anywhere in app code.

**Nothing outside `src/lib/jellyfin/` imports from `@jellyfin/sdk`.** Components take plain data
and call hooks. That directory is the whole server contract: `client.ts` (Api instance, device id),
`auth.tsx` (token in localStorage, validated on boot), `queries.ts` (TanStack Query hooks +
centralised `queryKeys`), `playback.ts`, `device-profile.ts`, `availability.ts`, `images.ts`,
`ticks.ts`.

TanStack Query owns all server state — there is no Redux/Zustand, deliberately. Request
`ItemFields` explicitly: `CARD_FIELDS` for grids, `DETAIL_FIELDS` for the detail page and player.

**Playback is negotiated, never constructed.** `POST /Items/{id}/PlaybackInfo` with the SDK's
`getBrowserDeviceProfile()` (do not hand-roll it) decides direct play vs. `TranscodingUrl`. Then
report the session — `Sessions/Playing`, `/Progress` every 10s, `/Stopped` on unmount. Skipping
`/Stopped` leaves ffmpeg running on the server after the tab closes. `usePlaybackSession` owns the
negotiation and reporting; `VideoPlayer` only plays.

**Drive-gone detection.** Jellyfin keeps claiming a film on an unplugged disk is directly playable,
so `availability.ts` probes `GET /Videos/{id}/stream?Static=true` with `Range: bytes=0-0` and
`cache: 'no-store'`. The `no-store` is load-bearing: without it the browser replays the cached 206
and the check passes forever.

**Skin.** `apps/web/src/index.css` bridges the generated tokens into Tailwind's `@theme` and onto
the shadcn-style names the primitives in `components/ui` consume, and defines the Reel utilities
(`.art-scrim`, `.hero-scrim`, `.panel`). Dark-only by intent, on all three clients. Text over
artwork always gets a scrim utility.

## Conventions

- Conventional commits with a scope, lowercase and written as a sentence:
  `perf(ios): the home screen asks for your resume list once`.
- Docs are part of the work, and there are deliberately only four. `docs/ROADMAP.md` holds status
  and the ordered next steps for all three clients — update it when you finish something. Each
  fork's README holds its build and its platform traps. Do not add a fifth document to `docs/`
  unless it has a job none of the four has.
