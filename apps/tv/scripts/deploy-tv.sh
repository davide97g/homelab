#!/usr/bin/env bash
#
# Build the JARVIS launcher and install it on the TV over ADB.
#
#   scripts/deploy-tv.sh                 build + install
#   scripts/deploy-tv.sh --launcher      also set it as the HOME launcher
#   scripts/deploy-tv.sh --restore       put the stock Google launcher back
#   scripts/deploy-tv.sh --no-build      install the last-built APK, skip the build
#
# The TV address defaults to what the project has used throughout; override with
#   TV=192.168.1.50 scripts/deploy-tv.sh
#
# ADB over the network is reset by a TV reboot. If `adb connect` fails, re-enable
# "USB debugging" + "Network debugging" in the TV's Developer options first.
set -euo pipefail

TV="${TV:-192.168.15.106}:5555"
PKG="it.davideghiotto.jarvistv"
ACT="$PKG/.HomeActivity"
STOCK="com.google.android.tvlauncher"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$here/jarvis-tv"
apk="$app/app/build/outputs/apk/release/app-release.apk"

# Pick an adb: PATH first, then the SDK's usual spot.
ADB="$(command -v adb || true)"
[ -z "$ADB" ] && [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ] && ADB="$HOME/Library/Android/sdk/platform-tools/adb"
[ -z "$ADB" ] && { echo "adb not found (install platform-tools or put adb on PATH)"; exit 1; }

connect() {
  "$ADB" connect "$TV" >/dev/null 2>&1 || true
  if ! "$ADB" -s "$TV" get-state >/dev/null 2>&1; then
    echo "Cannot reach the TV at $TV."
    echo "On the TV: Settings > Device Preferences > About > tap Build 7x,"
    echo "then Developer options > enable USB debugging and Network debugging."
    exit 1
  fi
}

set_launcher() {
  # Google TV pins the HOME role to its own launcher, so set-home-activity does not
  # stick. Disabling the stock launcher is the one thing that works; the app's own
  # "Ripristina launcher Google" button (and --restore here) puts it back.
  echo "Setting JARVIS as the HOME launcher..."
  "$ADB" -s "$TV" shell cmd package set-home-activity "$ACT" >/dev/null 2>&1 || true
  "$ADB" -s "$TV" shell pm disable-user --user 0 "$STOCK" >/dev/null
  "$ADB" -s "$TV" shell input keyevent KEYCODE_HOME
  echo "Done. HOME now opens JARVIS."
}

restore_launcher() {
  echo "Restoring the stock Google launcher..."
  "$ADB" -s "$TV" shell pm enable "$STOCK" >/dev/null
  "$ADB" -s "$TV" shell cmd package set-home-activity "$STOCK/.MainActivity" >/dev/null 2>&1 || true
  "$ADB" -s "$TV" shell input keyevent KEYCODE_HOME
  echo "Done. HOME now opens the Google launcher."
}

build=1
do_launcher=0
case "${1:-}" in
  --restore)   connect; restore_launcher; exit 0 ;;
  --launcher)  do_launcher=1 ;;
  --no-build)  build=0 ;;
  "")          ;;
  *)           echo "unknown option: $1"; sed -n '2,12p' "$0"; exit 1 ;;
esac

if [ "$build" = 1 ]; then
  echo "Building release APK..."
  # vfs.watch off on purpose: with it on, Gradle here has reported every task
  # UP-TO-DATE against edited sources and quietly shipped the previous APK.
  ( cd "$app" && JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}" \
      ./gradlew -q :app:assembleRelease -Dorg.gradle.vfs.watch=false )
fi
[ -f "$apk" ] || { echo "APK not found at $apk"; exit 1; }

connect
echo "Installing on $TV..."
"$ADB" -s "$TV" install -r "$apk" >/dev/null
echo "Installed $("$ADB" -s "$TV" shell dumpsys package "$PKG" | sed -n 's/.*versionName=//p' | head -1)"

[ "$do_launcher" = 1 ] && set_launcher
"$ADB" -s "$TV" shell monkey -p "$PKG" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 || true
echo "Launched."
