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
- The feature band, verified against the NAS library: backdrop, logo art, kind tag, match
  percentage, fact line, Play and Details, page dots. The rows underneath already matched Reel
  upstream — chevron headings and dot-separated details — so they needed nothing.
- Dark-only. Reel has no light values; the app now declares `preferredColorScheme(.dark)` at the
  root scene. Upstream's own `setAppearance` cannot do this at startup: it guards on `keyWindow`,
  which does not exist yet, and fails silently.

### Next, cheapest visual delta first

1. **Feature band polish.** It is edge-to-edge while the rows are inset, and its page dots sit
   outside the card rather than on it.
2. **Navigation chrome.** Rail on iPad, tab row on iPhone.
3. **Strings.** Upstream says "Swiftfin" in user-facing copy in a few places.
4. **App icon.** `apps/ios/Swiftfin/Swiftfin/Resources/Assets.xcassets` — still Jellyfin's, which
   is the most obvious remaining giveaway.
5. **Player.** Last. Swiftfin's controls are good; restyle, do not rewrite.

### Verifying on a simulator — read this before trying

`xcrun simctl` boots devices, installs, launches and screenshots **headlessly**, and all of that
works. What does not work is driving the UI:

- **Xcode 27 ships no `Simulator.app`.** The simulator UI is now
  `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`. `open -a Simulator` silently
  does nothing.
- DeviceHub draws the device with Metal. AppleScript `click at` does not reach it, and real
  CGEvent clicks only land if you know exactly where the device canvas is inside the window.
- Working that rectangle out needs a screenshot of the host screen, and `screencapture` fails
  with *could not create image from display* until the terminal has **Screen Recording**
  permission (System Settings → Privacy & Security → Screen Recording, then restart the
  terminal).

So: to verify anything that needs a signed-in session, either sign in by hand once in DeviceHub
(the session persists, and `xcrun simctl io <udid> screenshot` works from then on), or grant
Screen Recording first. A deep link cannot do it — Swiftfin's `swiftfin://` handler only resolves
sessions that already exist.

Driving it *is* possible without either, and this is how the feature band was verified: find the
device canvas in DeviceHub's accessibility tree (an `AXGroup` with the device's aspect ratio —
it was at `(839, 255)` size `297x647`, not where window arithmetic suggested), then post real
CGEvent mouse and key events at coordinates mapped into it. Three traps: synthetic AX clicks do
not reach the Metal canvas, `keyboardSetUnicodeString` is ignored so every character needs its
real keycode, and event modifier *flags* are ignored so shift must be a held key. The simulator's
hardware keyboard is also on an **Italian** layout, where `:` is shift+`.` and `/` is shift+`7`.

**Never build with `CODE_SIGNING_ALLOWED=NO`.** It produces an unsigned app with no entitlements,
so keychain writes fail silently and the app crashes in `User.accessToken` right after sign-in —
`assertionFailure("access token missing in keychain")`. Ad-hoc simulator signing is the default
and needs no development team; just leave the flag off.

### Installing on a real iPhone

```sh
xcrun devicectl list devices                    # find the UDID
xcrun devicectl device info lockState --device <UDID>
xcodebuild -project Swiftfin.xcodeproj -scheme Swiftfin -configuration Debug \
  -skipMacroValidation -allowProvisioningUpdates -destination "id=<UDID>" build
xcrun devicectl device install app --device <UDID> <path>.app
xcrun devicectl device process launch --device <UDID> it.davideghiotto.cinema
```

- **The phone must be unlocked**, or the build dies before compiling with *"needs to be unlocked
  to enable development services"*. The signal to wait on is
  `devicectl device info lockState` → `passcodeRequired: false`. Do **not** poll for the
  developer-disk-image error to clear: it clears while the device is still locked, and the build
  then times out waiting for the destination.
- Keep the screen awake for the whole build, or it can stall the same way.
- Signing: team `<team-id>` has a wildcard profile (`<team-id>.*`) that already covers
  `it.davideghiotto.cinema`. The team id goes in
  `apps/ios/Swiftfin/XcodeConfig/DevelopmentTeam.xcconfig`, which the fork gitignores, so it never
  reaches the public repository.

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
