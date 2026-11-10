#!/usr/bin/env bash
#
# Cinema for Android TV on the Philips set, over ADB.
#
#   apps/android/scripts/tv.sh                   build (debug, armeabi-v7a) + install + launch + follow logs
#   apps/android/scripts/tv.sh deploy --no-build install the last-built APK, launch, follow logs
#   apps/android/scripts/tv.sh deploy --no-logs  build + install + launch, then exit
#   apps/android/scripts/tv.sh logs              follow live logcat for the app (restarts with it)
#   apps/android/scripts/tv.sh logs --file       print the on-device log file (survives without adb)
#   apps/android/scripts/tv.sh logs --pull       copy cinema.log(.1) to ./tv-logs/
#
# TV=192.168.15.106 by default; TV=emulator-5554 for the Android TV AVD (then the
# ABI is arm64-v8a unless ABI= says otherwise).
#
# Run it from Terminal.app: Orca, and any adb server it started, has no macOS
# Local Network permission. The whole ADB-on-the-TV procedure is in
# ~/personal/projects/cassette/apps/tv/README.md, "Getting ADB onto the TV".
set -euo pipefail

TV="${TV:-192.168.15.106}"
case "$TV" in *emulator*|*:*) SERIAL="$TV" ;; *) SERIAL="$TV:5555" ;; esac
case "$SERIAL" in *emulator*) ABI="${ABI:-arm64-v8a}" ;; *) ABI="${ABI:-armeabi-v7a}" ;; esac
# Debug build: applicationIdSuffix ".debug", installs beside a release one, and is
# debuggable, which is what lets `run-as` read the log file back.
PKG="it.davideghiotto.cinema.debug"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fork="$here/findroid"
apk="$fork/app/tv/build/outputs/apk/libre/debug/tv-libre-$ABI-debug.apk"

ADB="$(command -v adb || true)"
[ -z "$ADB" ] && [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ] && ADB="$HOME/Library/Android/sdk/platform-tools/adb"
[ -z "$ADB" ] && { echo "adb not found (install platform-tools or put adb on PATH)"; exit 1; }
A() { "$ADB" -s "$SERIAL" "$@"; }

connect() {
  case "$SERIAL" in *emulator*) ;; *) "$ADB" connect "$SERIAL" >/dev/null 2>&1 || true ;; esac
  if ! A get-state >/dev/null 2>&1; then
    echo "Cannot use $SERIAL. adb says:"
    "$ADB" devices | sed -n '2,$p'
    echo
    echo "  unauthorized      -> accept \"Consentire debug USB?\" on the TV, run again"
    echo "  No route to host  -> '$ADB kill-server' from Terminal.app, run again"
    echo "  nothing listed    -> TV: Opzioni sviluppatore > Debug USB, then network debugging"
    exit 1
  fi
}

follow_logs() {
  echo "Following $PKG on $SERIAL (Ctrl+C to stop)..."
  # Re-resolve the pid when the app restarts or crashes; crash buffer too.
  while true; do
    pid="$(A shell pidof "$PKG" 2>/dev/null | tr -d '\r' || true)"
    if [ -z "$pid" ]; then sleep 1; continue; fi
    echo "--- pid $pid ---"
    A logcat -v time -b main,crash --pid="$pid" -T 1 || true
    sleep 1
  done
}

deploy() {
  local build=1 logs=1
  for a in "$@"; do
    case "$a" in --no-build) build=0 ;; --no-logs) logs=0 ;; *) echo "unknown: $a"; exit 2 ;; esac
  done
  if [ "$build" = 1 ]; then
    echo "Building :app:tv libre debug..."
    # vfs.watch off: Gradle on this Mac has reported edited sources UP-TO-DATE
    # and shipped the previous APK (homelab/apps/tv/README.md).
    ( cd "$fork" && JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}" \
        ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}" \
        ./gradlew -q :app:tv:assembleLibreDebug -Dorg.gradle.vfs.watch=false )
  fi
  [ -f "$apk" ] || { echo "APK not found at $apk"; exit 1; }
  connect
  echo "Installing $(basename "$apk") on $SERIAL..."
  A install -r "$apk" >/dev/null
  A shell am force-stop "$PKG" >/dev/null 2>&1 || true
  A logcat -c >/dev/null 2>&1 || true
  A shell monkey -p "$PKG" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 || true
  echo "Installed and launched."
  [ "$logs" = 1 ] && follow_logs
  return 0
}

logs() {
  connect
  case "${1:-}" in
    "") follow_logs ;;
    --file) A exec-out run-as "$PKG" cat files/logs/cinema.log ;;
    --pull)
      mkdir -p tv-logs
      for f in cinema.log.1 cinema.log; do
        A exec-out run-as "$PKG" cat "files/logs/$f" > "tv-logs/$f" 2>/dev/null || rm -f "tv-logs/$f"
      done
      ls -l tv-logs ;;
    *) echo "unknown: $1"; exit 2 ;;
  esac
}

cmd="${1:-deploy}"; [ $# -gt 0 ] && shift
case "$cmd" in
  deploy) deploy "$@" ;;
  logs) logs "$@" ;;
  --no-build|--no-logs) deploy "$cmd" "$@" ;;
  *) sed -n '3,16p' "$0"; exit 2 ;;
esac
