#!/usr/bin/env bash
#
# Debloat the TV over ADB, without root and fully reversibly.
#
#   scripts/debloat.sh --inventory   write every package + its state to scripts/.inventory.txt
#   scripts/debloat.sh               dry run: what debloat.txt would disable on this set
#   scripts/debloat.sh --apply       disable them (pm disable-user --user 0)
#   scripts/debloat.sh --restore     re-enable everything --apply ever disabled
#
# What was disabled is appended to scripts/.debloated.txt (git-ignored), so --restore
# undoes exactly this script's work and never touches the stock launcher, which
# deploy-tv.sh --launcher / --restore owns.
#
# TV=192.168.1.50 scripts/debloat.sh overrides the address, like deploy-tv.sh.
set -euo pipefail

TV="${TV:-192.168.15.106}:5555"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
list="$here/debloat.txt"
state="$here/.debloated.txt"
inventory="$here/.inventory.txt"

ADB="$(command -v adb || true)"
[ -z "$ADB" ] && [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ] && ADB="$HOME/Library/Android/sdk/platform-tools/adb"
[ -z "$ADB" ] && { echo "adb not found (install platform-tools or put adb on PATH)"; exit 1; }

adb_() { "$ADB" -s "$TV" "$@"; }

"$ADB" connect "$TV" >/dev/null 2>&1 || true
if ! adb_ get-state >/dev/null 2>&1; then
  echo "Cannot reach the TV at $TV. Re-enable USB + Network debugging (see README → ADB)."
  echo "'No route to host' while the TV is on: run this from Terminal.app, not Orca."
  exit 1
fi

wanted() { sed -e 's/#.*//' -e 's/[[:space:]]//g' "$list" | grep -v '^$' || true; }
installed() { adb_ shell pm list packages | sed 's/^package://' | tr -d '\r'; }
enabled()   { adb_ shell pm list packages -e | sed 's/^package://' | tr -d '\r'; }

case "${1:-}" in
  --inventory)
    {
      echo "# $(date '+%F %T')  $TV   [E]nabled [D]isabled  [s]ystem [3]rd party"
      dis="$(adb_ shell pm list packages -d | sed 's/^package://' | tr -d '\r')"
      sys="$(adb_ shell pm list packages -s | sed 's/^package://' | tr -d '\r')"
      installed | sort | while read -r p; do
        e=E; grep -qx "$p" <<<"$dis" && e=D
        s=3; grep -qx "$p" <<<"$sys" && s=s
        echo "$e$s  $p"
      done
    } > "$inventory"
    echo "Wrote $(($(wc -l < "$inventory") - 1)) packages to $inventory"
    ;;

  ""|--apply)
    on="$(enabled)"
    targets=()
    while read -r p; do
      grep -qx "$p" <<<"$on" && targets+=("$p")
    done < <(wanted)
    if [ "${#targets[@]}" = 0 ]; then echo "Nothing to disable: the set is already clean."; exit 0; fi
    printf '  %s\n' "${targets[@]}"
    if [ "${1:-}" != --apply ]; then
      echo "${#targets[@]} packages would be disabled. Run with --apply."
      exit 0
    fi
    ok=0
    for p in "${targets[@]}"; do
      # some system packages refuse disable-user; say so and carry on
      if out="$(adb_ shell pm disable-user --user 0 "$p" 2>&1)" && grep -q 'disabled-user' <<<"$out"; then
        echo "$p" >> "$state"; ok=$((ok + 1))
      else
        echo "  ! $p: $(tr -d '\r' <<<"$out" | tail -1)"
      fi
    done
    sort -u -o "$state" "$state"
    echo "Disabled $ok of ${#targets[@]}. Undo with --restore."
    ;;

  --restore)
    [ -s "$state" ] || { echo "Nothing recorded in $state."; exit 0; }
    while read -r p; do
      adb_ shell pm enable "$p" >/dev/null 2>&1 && echo "  + $p" || echo "  ! $p"
    done < "$state"
    rm -f "$state"
    echo "Restored."
    ;;

  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
