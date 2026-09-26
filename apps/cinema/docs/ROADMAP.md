# Roadmap

What is done, what is next, ordered by what unblocks the most. Status as of **2026-09-17**.

Build instructions for the forks live beside them — [`apps/ios/README.md`](../apps/ios/README.md)
and [`apps/android/README.md`](../apps/android/README.md), which also carry the toolchain and
verification traps each platform taught us.

---

## Web — live

<https://cinema.davideghiotto.it>, on the NAS, since 2026-09-17. [DEPLOY.md](DEPLOY.md) has the
shape of it and how to ship a change.

`jellyfin.davideghiotto.it` was taken down the same day: tunnel ingress and DNS record both
removed. Cinema is the only public entrance, and Jellyfin is reached at
`https://cinema.davideghiotto.it/jf`, which native clients accept as a server URL verbatim.
**Anything still pointed at the old hostname must be repointed by hand** — there is no redirect,
because the name no longer resolves. That includes Cinema for iOS on the phone, and the repo-root
`.env` used by `bun run dev` (`.env.local-backup` holds the values for the local Docker Jellyfin).

**Working:** auth and session restore, home with feature band and carousels, sortable library grid,
search, detail page with a technical media panel, direct-play/transcode negotiation, HLS via hls.js,
external subtitles, audio and subtitle pickers mid-playback (Italian, then English, on by default;
image subtitles burn in), custom controls with keyboard shortcuts, progress reporting and resume,
offline-drive detection, a live viewer count in the header with who is watching what.

**Next, in rough order of value:**

1. **Series navigation.** `useNextUp` exists and episodes render, but there is no season/episode
   browser. Add `getSeasons` / `getEpisodes` from `getTvShowsApi`.
2. **Quality selector.** Same mechanism as the track pickers — `usePlaybackSession`'s
   `renegotiate`, with `maxStreamingBitrate`. Send `MediaSourceId` with it: without one the server
   ignores the stream indexes in `PlaybackInfo` and silently answers with the defaults.
3. **Virtualised grid.** Fine to ~500 items; past that, TanStack Virtual.
4. **Tests.** There is no test setup at all. `availability.ts` and the ticks/format helpers are
   where a bug would be quiet rather than loud.

Chunk sizes are settled: the SDK is one shared 165 kB chunk, `index` is 332 kB and `PlayerRoute`
19 kB. What is left over 500 kB is hls.js behind the player's lazy import, and shrinking that means
a different decoder, not a different build config.

---

## iOS — the surface is Cinema's; the player is upstream's, restyled

Vendored at `apps/ios/Swiftfin`, forked from upstream `1.6.1-93-g52aaec38`.

**Done.** Reel palette and accent, bundle id `it.davideghiotto.cinema`, display name and app icon
Cinema, the Jellyfin blob gone from sign-in, Settings and About. Dark-only, declared as
`preferredColorScheme(.dark)` at the root scene — upstream's `setAppearance` cannot do it at
startup, because it guards on `keyWindow`, which does not exist yet, and fails silently. The feature
band, inset like the rows so it reads as the first item of one list, with page dots on the card, a
red progress hairline and time-left in the fact line mid-watch; 21:9 on iPad, 16:10 on a phone. iPad
gets `.tabViewStyle(.sidebarAdaptable)` — the web app's left rail, natively. Upstream's Customize
settings section is gone (all twenty-four alternate icons were Jellyfin's). The player is restyled,
not rewritten: the played span is the action colour, track and buffered span pinned neutral so
SwiftUI does not derive them and turn the whole bar red. The home screen asks for the resume list
once, not twice.

**Next.**

1. **The rows.** `PosterGroup`'s card is still upstream's; `apps/web`'s `MediaCard` carries a kind
   tag, title and dot-separated fact line on a scrim.
2. **Media tab.** Still upstream's `UserViewLibrary` under the name "Media"; the web rail's
   "Library" grouping is the better shape now the iPad has a real rail.
3. **The other locales** still say "Swiftfin". Only `en.lproj` was rewritten, then
   `Shared/Strings/Strings.swift` regenerated with `swift Scripts/Translations/GenerateStrings.swift`.

**Not verified on hardware.** Branding was (install, launch, screenshot). The home screen, settings
and player changes are **compile-verified only** — every simulator on this Mac is signed out. The
iOS README explains what that costs and how to get past it.

---

## Android — the surface is Cinema's, phone and TV

Vendored at `apps/android/findroid`, forked from upstream `v1.1.0-42-g8f713da4`. Five small,
mechanical commits' worth of change; the fork's `CINEMA.md` has the detail.

**Done.** Reel palette in both app modules' Material 3 schemes, application id
`it.davideghiotto.cinema`, name Cinema, the Lucide `film` mark as launcher icon, TV banner and
in-app logo. Dark-only, which on Android means **four** places: the Compose theme (where
`dynamicColor` defaulted to `true`, so Material You would have replaced the palette wholesale on any
Android 12+ device), the stored `pref_theme`/`pref_dynamic_colors` defaults, `AppCompatDelegate` in
`BaseApplication`, and `core/res/values/themes.xml`, parented on `Theme.Material3.DayNight` — that
last one is the window background, the system bars and the ExoPlayer control layouts, which are real
Views resolving `?attr/colorSurface`. The feature band on both home screens; phone gets Play and
Details, TV makes the whole card the control, because on a remote one focusable thing that plays
beats two that need a sideways press.

**What the emulator caught, and the compiler could not:** TV's selected tab was white on white —
upstream paints the pill `Color.White` and its label `colorScheme.onPrimary`, which under Reel is
also white. A role can be right in the abstract and wrong at a use site that assumed something about
it. And `values-night/themes.xml` is *not* dead once night mode is forced: it is the configuration
that applies, and its overrides were quietly reintroducing upstream's blue.

**Next.**

1. **The rows are still upstream's** — Findroid's card lists genres in a comma list and carries no
   kind tag.
2. **No release build exists** and nothing is signed. Sideloading a release APK or Play internal
   testing is untouched.
3. **Playback was only judged in an emulator**, which is jerky regardless of the app. Smoothness
   needs a real phone.
4. The other locales still say Findroid, deliberately: only the English copy was renamed, with
   upstream credited in the welcome text.

---

## The 2026-09-17 cleanup — done, and what it measured

Ten findings from reading the code and measuring the live site. All ten are closed; the outcomes are
kept because they are the argument for the shape the code now has, and the place to start if one of
them comes back. Re-measure before believing a number — the repository moves.

| # | Was | Now |
|---|---|---|
| 1 | iOS home fetched `/Items/Resume` twice per refresh, plus a usually-wasted recently-added | The band and the row share one view model; recently-added is fetched only after resume comes back empty |
| 2 | The SDK was inlined into both route chunks — parse and execute paid twice | `advancedChunks` in `vite.config.ts`: SDK 165 kB shared, `index` 484→332 kB, `PlayerRoute` 541→19 kB, hls.js its own group |
| 3 | `COPY packages` above the install busted the dependency cache on every token change | Moved down beside `COPY apps/web`; verified `bun install` reports `CACHED` with a hex changed |
| 4 | nginx defaulted to `gzip off`, so the LAN and the hop to `cloudflared` got 484 kB raw | `gzip on` (no brotli — not in `nginx:1.27-alpine`, and Cloudflare answers `br` at the edge) |
| 5 | The home skeleton was gated on `&&`, so it vanished when the *fastest* query resolved | Gated on the band being drawable in full, or every query having settled |
| 6 | The hero backdrop — almost certainly the LCP element — carried no priority hint | `fetchPriority="high"` |
| 7 | `CinemaTokens.swift` existed twice, kept in step by remembering to run a second script | `bun run tokens` writes it once, straight into the app (the sync scripts went with the submodules) |
| 8 | `JELLYFIN_UPSTREAM` and `CINEMA_PORT` retyped on every deploy — a typo shipped a container proxying to nothing | Defaults in `compose.yaml`; the deploy is a bare `docker compose up -d --build` |
| 9 | Dark forced in three places on iOS, two looking redundant | One was genuinely dead and is back at upstream's `.system`; the other two earn their place and now say why in a comment |
| 10 | The monorepo existed on one machine | Pushed to `github.com/davide97g/cinema`, public — see below. Since 2026-09-25 it lives in `apps/cinema` of the public `github.com/davide97g/homelab` |

Since then the two forks have been **vendored**: no submodules, no fork remotes, one repository and
one origin. It costs `git merge upstream/main` — see each fork's README for the manual route and
the upstream version it was forked from — and it moved a licence obligation onto this repository.
The public fork repositories no longer carry our modified MPL/GPL sources; **this one is public,
and that is what publishes them**, so it has to stay public while builds are distributed.
[`NOTICE.md`](../NOTICE.md) maps every part of the tree to its licence.

Structural decisions that look expensive and should be left alone are listed in
[ARCHITECTURE.md § 7](ARCHITECTURE.md).
