#!/usr/bin/env bash
#
# Attach your Swiftfin fork as the iOS app. Run it once, from anywhere:
#
#   apps/ios/bootstrap.sh git@github.com:<you>/Swiftfin.git
#
# A submodule rather than a vendored copy: the whole point of forking Swiftfin
# is being able to pull upstream's server-compatibility fixes forever.
set -euo pipefail

REMOTE=${1:-}
[ -n "$REMOTE" ] || { echo "usage: $0 <your-swiftfin-fork-remote>" >&2; exit 1; }

cd "$(dirname "$0")/../.."

git submodule add "$REMOTE" apps/ios/Swiftfin
git -C apps/ios/Swiftfin remote add upstream https://github.com/jellyfin/Swiftfin.git || true
git -C apps/ios/Swiftfin fetch upstream

cat <<'NOTE'

Next:
  bun run tokens                       # regenerate apps/ios/generated/CinemaTokens.swift
  open apps/ios/Swiftfin/Swiftfin.xcodeproj
  # add generated/CinemaTokens.swift to the Shared target, then work through
  # apps/ios/README.md "Applying the design".
NOTE
