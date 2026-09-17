#!/usr/bin/env bash
#
# Copy the generated palette into the Findroid fork.
#
#   bun run tokens              # runs this script with --if-present
#   apps/android/sync-tokens.sh # or on its own
#
# The fork is a separate git repository, so the token build deliberately does
# not write into it: the palette lands here as an ordinary, reviewable commit
# in the fork's own history.
#
# Two files, because Findroid is not all Compose. The Kotlin object feeds the
# Material 3 colour schemes; the XML resources feed core/res/values/themes.xml
# and the View-based ExoPlayer control layouts, which resolve ?attr/colorPrimary
# and ?attr/colorSurface rather than reading a Compose value.
#
# :core is the destination because both :app:phone and :app:tv depend on it,
# and it already pulls in androidx.compose.ui -- the only thing the generated
# Kotlin imports.
#
# --if-present exits quietly when the submodule is absent, which is how the
# tokens script can call this unconditionally and a submodule-less clone can
# still build the web app.
set -euo pipefail

cd "$(dirname "$0")/../.."

SRC_KT=apps/android/generated/CinemaTokens.kt
DEST_KT=apps/android/findroid/core/src/main/java/it/davideghiotto/cinema/design/CinemaTokens.kt

SRC_XML=apps/android/generated/cinema_tokens.xml
DEST_XML=apps/android/findroid/core/src/main/res/values/cinema_tokens.xml

[ -d apps/android/findroid ] || {
  [ "${1:-}" = --if-present ] && exit 0
  echo "apps/android/findroid is not checked out -- run apps/android/bootstrap.sh first." >&2
  exit 1
}

mkdir -p "$(dirname "$DEST_KT")" "$(dirname "$DEST_XML")"
cp "$SRC_KT" "$DEST_KT"
cp "$SRC_XML" "$DEST_XML"
echo "✓ $SRC_KT -> $DEST_KT"
echo "✓ $SRC_XML -> $DEST_XML"
