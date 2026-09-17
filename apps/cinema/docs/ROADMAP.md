# Roadmap

What is done, what is next, and what a future session needs to know to pick any of it up. Ordered
by what unblocks the most.

Status as of **2026-09-17**.

---

## 1. Deploy the web app — not started

`apps/web` runs only in development. Everything it needs is written up in
[DEPLOY.md](DEPLOY.md); nothing about it is blocked.

- Add `cinema.davideghiotto.it` to the Cloudflare tunnel → `http://localhost:3003`.
- Deploy `services/web/compose.yaml` as a Dokploy compose app.
- **Verify the network name first.** The compose file assumes the mediarr project's network is
  `mediarr_default`; check with `ssh homelab 'docker network ls | grep -i mediarr'`.
- `jellyfin.davideghiotto.it` stays pointed at Jellyfin itself — that is still the admin surface.

Do this before the mobile apps are pointed anywhere: every client stores the server URL it
signed in against, so the URL should be stable first.

**Development note:** the repo-root `.env` currently points `JELLYFIN_URL` at
`https://jellyfin.davideghiotto.it` (the NAS, through the tunnel) rather than at the local
container, because the local Jellyfin has two films in it. `.env.local-backup` holds the local
values. The LAN address `192.168.15.131:8096` is *not* reachable from the dev Mac; the tunnel is.

---

## 2. iOS — palette done, home screen next

The fork is [davide97g/Swiftfin](https://github.com/davide97g/Swiftfin), branch `cinema`,
attached as a submodule at `apps/ios/Swiftfin`. See [`../apps/ios/README.md`](../apps/ios/README.md)
for how to build it and how the palette gets there.

### Done

- Reel palette in, accent colour repointed, bundle id `it.davideghiotto.cinema`, display name
  Cinema. Verified in a simulator: the app installs as "Cinema" and its buttons are Cinema red.

### Next, cheapest visual delta first

1. **Home screen.** Mirror the web's feature band. See the architecture notes in
   `apps/ios/README.md` — upstream composes the home screen declaratively, so this is mostly a
   matter of adding one group type and reordering, not writing a screen.
2. **Navigation chrome.** Rail on iPad, tab row on iPhone.
3. **Strings.** Upstream says "Swiftfin" in user-facing copy in a few places.
4. **App icon.** `apps/ios/Swiftfin/Swiftfin/Resources/Assets.xcassets` — still Jellyfin's, which
   is the most obvious remaining giveaway.
5. **Player.** Last. Swiftfin's controls are good; restyle, do not rewrite.

### Housekeeping

- SwiftFormat is not installed on the dev Mac, so every build prints
  `error: SwiftFormat not installed` and carries on. `brew install swiftformat` silences it.
- Device builds need `apps/ios/Swiftfin/XcodeConfig/DevelopmentTeam.xcconfig` (gitignored) with
  `DEVELOPMENT_TEAM = <team id>`.
- The fork's default branch on GitHub is still `main`. Switching it to `cinema` would make the
  repo's landing page show Cinema's work rather than upstream's README.

---

## 3. Android — not started

`apps/android/bootstrap.sh <your-findroid-fork>` attaches a Findroid fork the same way iOS works.
`generated/CinemaTokens.kt` is already emitted and ready to feed a Compose `darkColorScheme`.

**Do not copy code between `apps/ios` and `apps/android`** — Findroid is GPLv3 and Swiftfin is
MPL-2.0, and mixing them would make the iOS app unshippable on the App Store. See
[LICENSING.md](LICENSING.md).

---

## 4. Web — smaller things left

- **The monorepo has no git remote.** It exists on one machine only. A private GitHub repo would
  be a backup; the iOS fork is already public and independent of this.
- **Chunk size.** `PlayerRoute` and the main bundle are both over 500 kB. hls.js is already split
  out; the next win is lazy-loading the Jellyfin SDK surface the player needs.
- **`services/web/nginx.conf` has never been exercised.** It is written but untested — the first
  deploy is also its first run.
- **No tests.** There is no test setup at all in `apps/web`. The availability probe
  (`lib/jellyfin/availability.ts`) and the ticks/format helpers are the parts where a bug would be
  quiet rather than loud.
