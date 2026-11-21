#!/usr/bin/env bash
#
# Build Memories for TV and install it on the Philips set over ADB.
#
#   apps/memories/tv/scripts/deploy.sh             build + install + launch
#   apps/memories/tv/scripts/deploy.sh --no-build  install the last-built APK
#
# Override the target with TV=192.168.1.50 (or TV=emulator-5554 for the
# Android TV emulator — anything containing "emulator" is used as a serial).
#
# Run it from Terminal.app: Orca has no Local Network permission, and neither
# does an adb server it started. README.md, "Install", has the
# whole procedure.
set -euo pipefail

TV="${TV:-192.168.15.106}"
case "$TV" in *emulator*|*:*) SERIAL="$TV" ;; *) SERIAL="$TV:5555" ;; esac
PKG="it.davideghiotto.memoriestv"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apk="$here/app/build/outputs/apk/release/app-release.apk"

ADB="$(command -v adb || true)"
[ -z "$ADB" ] && [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ] && ADB="$HOME/Library/Android/sdk/platform-tools/adb"
[ -z "$ADB" ] && { echo "adb not found (install platform-tools or put adb on PATH)"; exit 1; }

if [ "${1:-}" != "--no-build" ]; then
  echo "Building release APK..."
  # vfs.watch off: on this Mac Gradle has reported edited sources UP-TO-DATE and
  # shipped the previous APK (see apps/tv/README.md).
  ( cd "$here" && JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}" \
      ./gradlew -q :app:assembleRelease -Dorg.gradle.vfs.watch=false )
fi
[ -f "$apk" ] || { echo "APK not found at $apk"; exit 1; }

case "$SERIAL" in *emulator*) ;; *) "$ADB" connect "$SERIAL" >/dev/null 2>&1 || true ;; esac
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  echo "Cannot use $SERIAL. adb says:"
  "$ADB" devices | sed -n '2,$p'
  echo
  echo "  unauthorized      -> accept \"Consentire debug USB?\" on the TV, run again"
  echo "  No route to host  -> '$ADB kill-server' from Terminal.app, run again"
  echo "                       (a server started by an app without Local Network permission)"
  echo "  nothing listed    -> TV: Opzioni sviluppatore > Debug USB, then network debugging"
  echo "See apps/tv/README.md, \"Getting ADB onto the TV\"."
  exit 1
fi
echo "Installing on $SERIAL..."
"$ADB" -s "$SERIAL" install -r "$apk" >/dev/null
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 || true
echo "Installed and launched."
