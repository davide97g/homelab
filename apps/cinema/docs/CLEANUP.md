# Cleanup

Complexity worth removing and slowness worth fixing, found by reading the code and measuring the
live site on **2026-09-17**. Separate from [ROADMAP.md](ROADMAP.md), which is features: nothing
here adds a screen, and a user would notice only items 1, 2 and 7.

Each task is written to be picked up cold, by a session or an agent with no memory of this one:
what is wrong, where, why it is wrong, how to fix it, and how to know it worked. **Tasks 1–9 touch
disjoint files and can run in parallel.** The one ordering constraint is noted in task 3.

**All ten are done as of 2026-09-17**, each with a note under its heading saying what was
actually changed and what was measured afterwards. The findings are kept rather than deleted:
they are the argument for the shape the code now has, and the place to start if one of them comes
back. Task 4 carries the one check that can only be made from the NAS.

Measurements are reproducible — the commands that produced them are in each task. Re-measure
before believing a number here; the repository moves.

---

## 1. iOS: the home screen fetches your resume list twice

**Done, 2026-09-17.** The band owns the resume view model and `ResumeRowContentGroup` shares it —
`ContentGroupViewModel` uniques view models by identity, so the screen asks once. Recently-added is
fetched only after the resume list comes back empty, at the band's own page size.

**Files** `apps/ios/Swiftfin/Shared/ViewModels/ContentGroupViewModel/DefaultContentGroupProvider.swift:57-68`,
`apps/ios/Swiftfin/Shared/Cinema/FeatureContentGroup.swift:75-76`

The provider builds two independent libraries over the same endpoint:

```swift
FeatureContentGroup(
    resumeLibrary: ResumeItemsLibrary(mediaTypes: [.video]),   // line 58
    recentlyAddedLibrary: RecentlyAddedLibrary()
)

PosterGroup(
    library: ResumeItemsLibrary(mediaTypes: [.video]),         // line 63
    posterDisplayType: .landscape,
    ...
)
```

Each owns its own `PagingLibraryViewModel(…, pageSize: 20)`, so opening the home screen issues two
identical `/Items/Resume` requests, and pull-to-refresh issues two more. The band then shows
`Array(source.prefix(5))` — forty items fetched to display five.

`RecentlyAddedLibrary` is fetched alongside it on every refresh purely as the fallback for *when
there is nothing to resume*, which is the uncommon case. That is a third request, usually wasted.

**Fix.** Share one view model rather than one library. Upstream already does this on tvOS, three
lines below, and it is the pattern to copy:

```swift
CinematicRecentlyAddedContentGroup(
    viewModel: cinematicSelectionContentGroup.viewModel
)
```

So: let the resume `PosterGroup` own the view model and hand it to `FeatureContentGroup`, or give
the band a resolved list rather than a library. Then make the recently-added fetch lazy — it
should not start until the resume list has come back empty. Drop `pageSize` to something near what
the band actually shows while you are there; the row below wants more than five, so size it for
the row, not for the band.

**Verify.** Point the app at a server you can watch, or add a temporary `Logger.swiftfin()` line
in `PagingLibraryViewModel.refresh()`. Open the home screen, pull to refresh, count
`/Items/Resume`. One per refresh, not two. The band and the row must still populate, and the band
must still fall back to recently-added on an account with nothing in progress — test both.

## 2. Web: the Jellyfin SDK ships in both chunks

**Done, 2026-09-17.** `rolldownOptions.output.advancedChunks` in `apps/web/vite.config.ts`. The SDK
is one 165 kB chunk both routes reference; `index` fell 484 → 332 kB and `PlayerRoute` 541 → 19 kB.
hls.js got a group of its own: it is the player's alone, so the remaining over-500 kB warning is now
one vendor file (508 kB) rather than route code, and a player change no longer re-downloads the
decoder.

**Files** `apps/web/src/lib/jellyfin/*`, `apps/web/vite.config.ts`

`bun run build`, today:

```
dist/assets/index-*.js         484.49 kB │ gzip: 137.01 kB
dist/assets/PlayerRoute-*.js   540.84 kB │ gzip: 166.09 kB
```

Both are over Vite's 500 kB warning, and both carry the Jellyfin SDK, because `PlayerRoute` is
lazily imported and pulls its own copy of everything it touches under `lib/jellyfin/`.

**This is not a transfer problem.** Cloudflare compresses at the edge — verified with
`curl -sI -H 'Accept-Encoding: gzip, br' https://cinema.davideghiotto.it/assets/index-*.js`,
which answers `content-encoding: br`. The cost is parse and execute on a phone, and it is paid
twice.

**Fix.** A manual chunk for the shared SDK surface, so `index` and `PlayerRoute` reference one copy
instead of inlining two. `lib/jellyfin/` is already the only place that imports `@jellyfin/sdk`
— that boundary is what makes this a config change rather than a refactor — and the imports are
already per-endpoint (`getItemsApi`, `getUserViewsApi`, …) rather than whole-namespace, so there
is little left to prune by hand.

**Verify.** `bun run build` and read the chunk table. Success is the SDK appearing in one chunk;
both route chunks should fall well under 500 kB. Then actually load the app and press play — a
mis-specified manual chunk breaks lazily, at runtime, not at build time.

## 3. Deploy: a token change reinstalls every dependency on the NAS

**Done, 2026-09-17.** `COPY packages` now sits with `COPY apps/web`. Verified by building the image
twice from a clean copy of the tree with one hex changed in `tokens.json` between them: `RUN … bun
install --frozen-lockfile` reported `CACHED`, and `#abcdef` reached the built CSS.

**File** `apps/web/Dockerfile:7-13`

```dockerfile
COPY package.json ./
COPY packages ./packages          # ← invalidates the layer below
COPY apps/web/package.json apps/web/bun.lock ./apps/web/
RUN cd apps/web && bun install --frozen-lockfile

COPY apps/web ./apps/web
RUN bun run packages/design-tokens/build.ts && cd apps/web && bun run build
```

`packages/` is copied before the install, so editing `tokens.json` — the thing most likely to
change between deploys — busts the dependency cache and reinstalls everything. The NAS is the
build machine, and it is slower than the Mac.

**Fix.** Move `COPY packages ./packages` to sit with `COPY apps/web ./apps/web`, just above the
build. It is safe: `apps/web/package.json` has no dependency on `@cinema/design-tokens`, so the
install does not read `packages/` at all — only the `build.ts` run on line 13 does. Confirm that
is still true before moving it.

**Verify.** Deploy twice per [DEPLOY.md](DEPLOY.md), changing only a hex value in `tokens.json`
between them, and watch the second build. `bun install` should report a cache hit. Then confirm
the new colour actually reaches the page, which is the thing this change could silently break.

**Ordering:** if task 4 is also being done, do this one first — both edit the same file.

## 4. Web: no compression for anything that skips Cloudflare

**Done, 2026-09-17.** `gzip on` in `services/web/nginx.conf`, no brotli. Verified against the built
image locally: js and css answer `content-encoding: gzip` with `Vary: Accept-Encoding`. **Still to
check on the NAS after the next deploy:** that the public URL answers `br` and not `gzip` — if it
flipped, nginx is compressing ahead of the edge.

**File** `services/web/nginx.conf`

nginx's own default is `gzip off`, and the config does not turn it on. Public traffic does not
care, for the reason in task 2, but `http://<nas-lan-ip>:8898` on the LAN gets 484 kB
uncompressed, and so does the hop from nginx to `cloudflared`.

**Fix.** `gzip on` with a `gzip_types` covering `application/javascript text/css application/json`
and a `gzip_min_length`. Do not add brotli — it is not in `nginx:1.27-alpine`, and the edge
already provides it where it matters.

**Verify.** `ssh nas 'curl -sI -H "Accept-Encoding: gzip" http://localhost:8898/assets/…js'`
answers `content-encoding: gzip`. Check the public URL still answers `br` afterwards, not `gzip`
— if it flipped, nginx is now compressing ahead of the edge and the edge is passing it through,
which is a downgrade.

## 5. Web: the home skeleton disappears before the content exists

**Done, 2026-09-17.** The gate is now `featured.length < BAND_SIZE && (…isLoading || …)`: the
skeleton lasts until the band can be drawn in full, or until every query has settled.

**File** `apps/web/src/routes/HomeRoute.tsx:34`

```ts
const loading = resume.isLoading && latest.isLoading && suggested.isLoading
```

`&&`, so the skeleton is dismissed as soon as the *fastest* of the three resolves. `featured` is
built from four queries and sliced into `hero` and `beside`, so the band renders with whatever has
landed and then reflows as the rest arrives.

**Fix.** Gate on the data the band actually uses. The band needs `featured` to be non-empty, not
all four queries to be settled — `!featured.length && (resume.isLoading || nextUp.isLoading || …)`
is closer to the truth than either `&&` or `||`.

**Verify.** Throttle to Slow 3G in devtools and reload. The band should go skeleton → content
once, with no intermediate state where one card is real and two are missing.

## 6. Web: the hero image is not prioritised

**Done, 2026-09-17.** `fetchPriority="high"` on the backdrop.

**File** `apps/web/src/components/media/FeatureCard.tsx:37-42`

The backdrop is the largest element above the fold and almost certainly the LCP element, and it
carries no `fetchPriority`. `MediaCard` gets this right in the other direction (`loading="lazy"`,
line 48) — the hero simply needs the opposite hint.

**Fix.** `fetchPriority="high"` on that `<img>`. One attribute. Do **not** add `loading="eager"`;
it is already the default and says nothing.

**Verify.** Lighthouse, or devtools' Performance panel: the backdrop request should start in the
first wave rather than behind the card artwork.

## 7. Tokens: two copies of one generated file, kept in step by hand

**Done, 2026-09-17.** `bun run tokens` ends with `apps/ios/sync-tokens.sh --if-present`, which
copies the palette into the fork when the submodule is there and exits quietly when it is not. The
script still runs on its own, and says what is wrong when it is run by hand without the submodule.
`apps/ios/README.md` and the fork's `CINEMA.md` now document one command.

**Files** `packages/design-tokens/build.ts`, `apps/ios/sync-tokens.sh`

`bun run tokens` writes `apps/ios/generated/CinemaTokens.swift`. `apps/ios/sync-tokens.sh` then
copies it to `apps/ios/Swiftfin/Shared/Cinema/CinemaTokens.swift`. Both are committed, in two
different repositories, and they are the same bytes. Skip the second command and the fork silently
keeps the old palette.

[`apps/ios/README.md`](../apps/ios/README.md) justifies the split as keeping the palette a
reviewable commit in the fork's own history. That reason survives automation — it is still a
commit in the fork either way. What the manual step buys is the chance to forget.

**Fix.** Have the `tokens` script run `apps/ios/sync-tokens.sh` when `apps/ios/Swiftfin` is checked
out, and say nothing when it is not (a fresh clone without submodules must still build the web
app). Keep `sync-tokens.sh` runnable on its own. Then update the README and the fork's `CINEMA.md`,
both of which currently document the two-step version.

**Verify.** Change a hex in `tokens.json`, run `bun run tokens` alone, and confirm
`git -C apps/ios/Swiftfin status` shows the change. Then `git submodule deinit apps/ios/Swiftfin`
and run it again — it must succeed, not fail.

## 8. Deploy: the environment is retyped on every deploy

**Done, 2026-09-17.** `compose.yaml` already carried the NAS values as defaults, so the documented
command is now a bare `docker compose up -d --build`; any other host overrides with an `.env` beside
`compose.yaml`, which the deploy tar does not overwrite.

**Files** [DEPLOY.md](DEPLOY.md), `services/web/compose.yaml`

The deploy command carries its configuration inline:

```sh
JELLYFIN_UPSTREAM=http://172.17.0.1:8899 CINEMA_PORT=8898 docker compose up -d --build
```

Both values are properties of the NAS, not of the deploy, and they have been stable since the
first one. Typing them every time is the only step where a typo ships a container that builds,
starts, and proxies to nothing.

**Fix.** An `.env` beside `compose.yaml` on the NAS — `docker compose` reads it automatically —
or defaults in `compose.yaml` itself. The tar in DEPLOY.md already excludes `.env`, so a file on
the box will not be overwritten by a deploy. Shorten the documented command to match.

**Verify.** Deploy with the bare `docker compose up -d --build` and run DEPLOY.md's existing
checks: `curl` on `:8898` answers 200, and `/jf/System/Info/Public` answers JSON.

## 9. iOS: dark is forced in three places

**Done, 2026-09-17.** One of the three was dead: nothing reads the value of
`Defaults[.appAppearance]` — only `Defaults.updates(.appAppearance)`, which ignores it and applies
dark — so that key is back at upstream's `.system`. The other two both earn their place and now say
so: `RootCoordinator.applyAppAppearance()` is the `UIWindow.overrideUserInterfaceStyle` that reaches
UIKit-hosted screens *and* what writes `Defaults[.appearance]`, which `applyAccentColor` reads to
mix for contrast; `SwiftfinApp`'s `preferredColorScheme(.dark)` covers the SwiftUI hierarchy from
the first frame, before a key window exists. (Upstream's own `.colorScheme(.dark)` in
`VideoPlayerViewShim` is a fourth, and is not ours.)

**Files** `apps/ios/Swiftfin/Shared/Services/SwiftfinDefaults.swift`,
`Shared/Coordinators/Root/RootCoordinator.swift`, `Swiftfin/App/SwiftfinApp.swift`

The stored default is `.dark`, `applyAppAppearance()` ignores the stored value and applies dark,
and the root scene declares `preferredColorScheme(.dark)`. Two of the three look redundant.

**Investigate before cutting.** They are probably not equivalent: `preferredColorScheme` covers
the SwiftUI hierarchy, while the coordinator's `UIWindow.overrideUserInterfaceStyle` is what
reaches UIKit-hosted screens — the video player among them. The stored default is what a fresh
install starts from. Deleting the wrong one gives a light-mode player on a dark-mode phone, which
is exactly the bug the three of them were added to kill.

**Fix.** Establish which one is load-bearing for the player, keep it, delete what is genuinely
dead, and leave a comment saying why the survivor cannot go. If all three earn their place, write
that down instead and close the task.

**Verify.** Set iOS to Light, then open the app, the settings sheet, and a video. All three stay
dark. Then delete and reinstall, with the phone still in Light, and check again — that is the path
the stored default covers.

## 10. The monorepo exists on one machine

**Done, 2026-09-17** — outside this list. `origin` is the private
`github.com/davide97g/cinema`, last pushed the same day. What is left is a habit rather than a
task: `main` runs ahead of `origin/main` between pushes, so the machine is still the only copy of
whatever is not pushed yet.

---

## Leave alone

Three structural decisions look expensive and are not. A session picking up the list above should
not "simplify" them:

- **The same-origin `/jf` proxy.** It is why CORS never has to be configured and why `api_key`
  never crosses an origin. See [ARCHITECTURE.md § 1](ARCHITECTURE.md).
- **`lib/jellyfin/` as the only importer of `@jellyfin/sdk`.** It is what makes task 2 a config
  change rather than a refactor, and what keeps an SDK upgrade to one directory.
- **`tar | ssh` as the deploy.** No registry, no CI, no credentials to rotate. The NAS builds its
  own image because it is x86_64 and the Mac is not; that is the whole reason, and it is a good one.

Likewise, the forks keep their diff against upstream small and mechanical on purpose —
`git merge upstream/main` is where server-compatibility fixes arrive. A cleanup that grows the
diff has cost something, even if it reads better.
