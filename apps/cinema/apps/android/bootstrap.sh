#!/usr/bin/env bash
#
# Attach your Findroid fork as the Android app. Run it once, from anywhere:
#
#   apps/android/bootstrap.sh git@github.com:<you>/findroid.git
#
# A submodule rather than a vendored copy: the whole point of forking Findroid
# is being able to pull upstream's server-compatibility fixes forever.
set -euo pipefail

REMOTE=${1:-}
[ -n "$REMOTE" ] || { echo "usage: $0 <your-findroid-fork-remote>" >&2; exit 1; }

cd "$(dirname "$0")/../.."

git submodule add "$REMOTE" apps/android/findroid
git -C apps/android/findroid remote add upstream https://github.com/jarnedemeulemeester/findroid.git || true
git -C apps/android/findroid fetch upstream

cat <<'NOTE'

Next:
  bun run tokens                       # regenerate apps/android/generated/CinemaTokens.kt
  # open apps/android/findroid in Android Studio, put CinemaTokens.kt in the
  # core module, then work through apps/android/README.md "Applying the design".
NOTE
