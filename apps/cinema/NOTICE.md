# Notice

Cinema is a front end for [Jellyfin](https://jellyfin.org). Two of its three clients are forks of
other people's applications, vendored into this repository as ordinary source. This file says who
wrote what, and under which licence, because most of the work here was not done by us.

## Written for Cinema

Copyright © 2026 Davide Ghiotto — [@davide97g](https://github.com/davide97g),
[davideghiotto.it](https://davideghiotto.it) — under the [MIT licence](LICENSE).

| Part | What it is |
|---|---|
| `apps/web` | The React client, and the reference implementation of the design |
| `packages/design-tokens` | `tokens.json` and the generator that emits the palette for all three clients |
| `services/` | The dev Jellyfin stack and the production nginx image |
| `docs/` | Architecture, design language, deployment, roadmap |
| `apps/ios/make-app-icon.swift`, `apps/android/make-app-icon.sh` | Icon generation |
| Inside the forks: everything under `Shared/Cinema/`, `CINEMA.md`, `CinemaColors.kt`, and the generated `CinemaTokens.*` | Cinema's own files, added to the forks |

`apps/web/src/components/ui` came from [duck/ui](https://duckui.davideghiotto.it), the same
author's design system, and is MIT with the rest.

## Vendored upstream work

### apps/ios/Swiftfin — [Swiftfin](https://github.com/jellyfin/Swiftfin)

Copyright © Jellyfin & Jellyfin Contributors. **MPL-2.0**, in
[`apps/ios/Swiftfin/LICENSE.md`](apps/ios/Swiftfin/LICENSE.md).

Swiftfin is the native SwiftUI Jellyfin client. Cinema is a reskin of it: `AVPlayer` playback with
Jellyfin's transcode negotiation, offline downloads and everything else under the surface are
theirs. MPL-2.0 is file-scoped copyleft, so the Swiftfin files this fork modifies stay MPL-2.0 and
their source is published here, which is what the licence asks. Forked at `1.6.1-93-g52aaec38`.

### apps/android/findroid — [Findroid](https://github.com/jarnedemeulemeester/findroid)

Copyright © Jarne Demeulemeester and contributors. **GPL-3.0**, in
[`apps/android/findroid/LICENSE`](apps/android/findroid/LICENSE).

Findroid is the native Kotlin/Compose Jellyfin client, on Media3/ExoPlayer, with Android TV
support. Cinema is a reskin of it. GPL-3.0 is whole-work copyleft: this fork's complete source is
published here under GPL-3.0, which is what the licence asks. Forked at `v1.1.0-42-g8f713da4`.

**The two forks never exchange code**, in either direction. GPL-3.0 code entering the Swiftfin fork
would relicense it, and a GPL-3.0 app cannot ship on the App Store. See
[`docs/ARCHITECTURE.md` § 6](docs/ARCHITECTURE.md).

## The server, and the libraries

Jellyfin itself is unmodified and is not redistributed here — Cinema talks to it over its REST API.
Jellyfin is GPL-2.0, and using a network API is not derivative work.

Everything below is a dependency, resolved at build time and not vendored:

| Dependency | Licence | Used for |
|---|---|---|
| [`@jellyfin/sdk`](https://github.com/jellyfin/jellyfin-sdk-typescript) | MPL-2.0 | The web client's whole server contract, unmodified |
| [hls.js](https://github.com/video-dev/hls.js) | Apache-2.0 | HLS playback where the browser has none |
| [React](https://react.dev), [TanStack Query](https://tanstack.com/query), [React Router](https://reactrouter.com) | MIT | The web client |
| [Radix UI](https://www.radix-ui.com) | MIT | Slider and slot primitives |
| [Lucide](https://lucide.dev) | ISC | Icons, including the `film` glyph Cinema uses as its mark |
| [Geist](https://vercel.com/font), [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | OFL-1.1 | Typefaces |
| [Tailwind CSS](https://tailwindcss.com), [Vite](https://vite.dev), [Bun](https://bun.sh), [oxlint](https://oxc.rs) | MIT | Build and tooling |

Swiftfin ships Noto Sans CJK (OFL-1.1) for subtitle rendering; it is upstream's file, kept as
upstream had it.

## If something here is miscredited

Open an issue. Attribution mistakes are worth fixing quickly and there is no argument to have about
them.
