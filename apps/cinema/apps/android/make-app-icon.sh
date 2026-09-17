#!/usr/bin/env bash
#
# Render the Play Store icon into the Findroid fork.
#
#   apps/android/make-app-icon.sh
#
# The launcher and banner icons in the fork are vector drawables referencing
# @color/cinema_*, so they follow the palette on their own. The Play Store entry
# is the one place that needs a raster, and Google wants it at 512x512.
#
# Both colours are read from packages/design-tokens/tokens.json, so the icon
# cannot drift from the palette, and the glyph is the same Lucide `film` the
# vector drawables use.
set -euo pipefail

cd "$(dirname "$0")/../.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DEST=apps/android/findroid/core/src/main/ic_launcher-playstore.png

[ -d apps/android/findroid ] || {
  echo "apps/android/findroid is not checked out -- run apps/android/bootstrap.sh first." >&2
  exit 1
}
[ -x "$CHROME" ] || { echo "Google Chrome is needed to rasterise the icon." >&2; exit 1; }

CANVAS=$(bun -e 'console.log(require("./packages/design-tokens/tokens.json").color.canvas.hex)')
PRIMARY=$(bun -e 'console.log(require("./packages/design-tokens/tokens.json").color.primary.hex)')

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/icon.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="$CANVAS"/>
  <g transform="translate(140 140) scale(9.6667)" fill="none" stroke="$PRIMARY"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5,3 h14 a2,2 0 0 1 2,2 v14 a2,2 0 0 1 -2,2 h-14 a2,2 0 0 1 -2,-2 v-14 a2,2 0 0 1 2,-2 z"/>
    <path d="M7,3 V21 M3,7.5 H7 M3,12 H21 M3,16.5 H7 M17,3 V21 M17,7.5 H21 M17,16.5 H21"/>
  </g>
</svg>
SVG

"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=00000000 --window-size=512,512 \
  --screenshot="$WORK/icon.png" "file://$WORK/icon.svg" >/dev/null 2>&1

cp "$WORK/icon.png" "$DEST"
echo "✓ $DEST"
