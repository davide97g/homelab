# Licensing

Three clients, three different obligations. Getting this wrong is expensive late and free now.

## apps/web — ours

Written against Jellyfin's REST API. Using an API is not derivative work, so nothing in
Jellyfin's GPL reaches this code. `src/components/ui` came from duck/ui, which is ours as well.

Never copy code out of `jellyfin-web` (GPLv3) into it. A CSS technique is not code; a component
is.

## apps/ios — Swiftfin, MPL-2.0

File-scoped copyleft:

- Swiftfin files we modify stay MPL-2.0 and their source must be published.
- New files we add can be licensed as we like.
- **App Store distribution is fine.** This is the reason iOS forks Swiftfin.

Keep the upstream `LICENSE` and attribution intact.

## apps/android — Findroid, GPLv3

Whole-work copyleft: distributing a build means publishing this fork's complete source under
GPLv3. Google Play is fine with that.

## The one rule

**Never move code between `apps/ios` and `apps/android`.** GPLv3 code entering the Swiftfin
fork would relicense it, and a GPLv3 app cannot ship on the App Store at all — Apple's terms
impose restrictions GPLv3 forbids, which is what got GNU Go pulled. Shared logic goes in
`packages/`, written by us, or it gets written twice.

Generated files (`CinemaTokens.swift`, `CinemaTokens.kt`) are ours: they come from
`tokens.json`, not from either upstream.
