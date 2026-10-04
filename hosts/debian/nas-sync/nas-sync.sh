#!/usr/bin/env bash
#
# Copy files that arrive in the library to the NAS, one file at a time, and
# only files that arrived after the baseline was taken.
#
#   library/movies/<Film (Year)>/<file>         ->  /volume1/media/Movies/<Film (Year)>/<file>
#   library/tv/<Series>/Season N/<file>          ->  /volume1/media/tv/<Series>/Season N/<file>
#
# Per file rather than per folder, unlike the old xfer-nas-auto.sh: a new
# episode lands in a season folder that already exists, and only that episode
# is new. Copying its folder would also send every older episode beside it.
#
# The on/off switch is the file control/enabled, which the hub writes ("on" or
# "off") from monitoring.davideghiotto.it. Off stops a running copy within two
# seconds; the copy resumes byte-exact when it comes back on. New files keep
# queueing while it is off and go across once it is on again.
#
# Everything the hub shows is read from control/, which it mounts:
#   enabled       on | off                          written by the hub only
#   baseline.txt  files present when sync was set up, never sent
#   done.txt      files sent and md5-verified
#   queue.tsv     size  rel  ready|settling         what is waiting
#   current.tsv   rel  send|verify  bytes  total  started
#   recent.tsv    at  done|failed|paused|full  rel  message   (last 30)
#   tick.tsv      at  note                          the last run
#   nas.tsv       free_kb  at
#
# Nothing is ever deleted, here or on the NAS. Same transport as xfer-nas.sh
# and for the same reason (the NAS's rsync rejects every path): resume by
# appending the missing tail over ssh, then md5 on both ends.
#
# Run by nas-sync.timer every 2 minutes, and by nas-sync.path the moment the
# switch changes. One flock, so a two-hour copy just blocks the next ticks.

set -uo pipefail

NAS_SSH="${NAS_SSH:-nas}"
LIB="${LIB:-/home/davide/media/library}"
NAS_ROOT="${NAS_ROOT:-/volume1/media}"
HOME_DIR="${NAS_SYNC_HOME:-$HOME/ops/xfer-nas}"
CTL="$HOME_DIR/control"
# Radarr writes the file, Bazarr drops subtitles beside it later. A file is
# left alone until it has been still this long.
QUIET_MIN="${QUIET_MIN:-5}"
HEADROOM_GB="${HEADROOM_GB:-5}"
# Network retries per file per run; a file that still fails waits for the next run.
RETRIES="${RETRIES:-3}"

LOG="$HOME_DIR/nas-sync.log"
LOCK="$HOME_DIR/.nas-sync.lock"
FLAG="$CTL/enabled"
BASELINE="$CTL/baseline.txt"
DONE="$CTL/done.txt"

export LC_ALL=C
SSH=(ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=20 -o ServerAliveCountMax=3)

mkdir -p "$CTL"
say() { printf '%s %s\n' "$(date -Is)" "$*" >> "$LOG"; }
# Every file the hub reads is replaced whole, so it never sees half of one.
put() { local f=$1 t; t="$1.tmp.$$"; cat > "$t" && mv -f "$t" "$f"; }
tick() { printf '%s\t%s\n' "$(date -Is)" "$*" | put "$CTL/tick.tsv"; }
recent() {
  printf '%s\t%s\t%s\t%s\n' "$(date -Is)" "$1" "$2" "${3:-}" >> "$CTL/recent.tsv"
  tail -n 30 "$CTL/recent.tsv" | put "$CTL/recent.tsv"
}
enabled() { [ "$(cat "$FLAG" 2>/dev/null)" = on ]; }

nas_dir() { case "$1" in movies) echo Movies ;; *) echo "$1" ;; esac; }
remote_of() { local rel=$1; echo "$NAS_ROOT/$(nas_dir "${rel%%/*}")/${rel#*/}"; }

exec 9>"$LOCK"
flock -n 9 || exit 0

# Library files, relative to $LIB. Hidden files and anything a client is still
# writing are not library files.
list_library() {
  ( cd "$LIB" 2>/dev/null && find movies tv -type f \
      ! -name '.*' ! -name '*.part' ! -name '*.partial~' ! -name '*.!qB' ! -name '*.tmp' \
      2>/dev/null ) | sort
}
settling() { [ -n "$(find "$LIB/$1" -newermt "-${QUIET_MIN} minutes" -print -quit 2>/dev/null)" ]; }

# --- baseline: what is here now is never sent --------------------------------
# A file still being written when the baseline is taken is left out of it, so
# it counts as new once it settles.
if [ ! -f "$BASELINE" ]; then
  list_library | while IFS= read -r rel; do settling "$rel" || printf '%s\n' "$rel"; done | put "$BASELINE"
  say "baseline taken: $(wc -l < "$BASELINE") file(s) will never be sent"
fi
touch "$DONE"
[ -f "$FLAG" ] || echo off | put "$FLAG"

# --- queue -------------------------------------------------------------------
build_queue() {
  # Smallest first: the NAS-side subtitle lands in seconds, the remux after it.
  comm -23 <(list_library) <(sort -u "$BASELINE" "$DONE") | while IFS= read -r rel; do
    state=ready; settling "$rel" && state=settling
    printf '%s\t%s\t%s\n' "$(stat -c %s "$LIB/$rel" 2>/dev/null || echo 0)" "$rel" "$state"
  done | sort -n | put "$CTL/queue.tsv"
}
build_queue
rm -f "$CTL/current.tsv"

if ! enabled; then
  tick "off — $(wc -l < "$CTL/queue.tsv") file(s) waiting"
  exit 0
fi

# A transfer started by hand with xfer-nas.sh writes to the same NAS.
if tmux has-session -t xfer-nas 2>/dev/null; then
  tick "waiting — a manual xfer-nas transfer is running"
  exit 0
fi

if ! "${SSH[@]}" "$NAS_SSH" true 2>/dev/null; then
  tick "NAS unreachable over ssh"
  say "NAS unreachable -- skipping this run"
  exit 0
fi

# Free space under NAS_ROOT, asked of the nearest directory that exists: the
# Movies or tv folder may not have been created yet. Empty if unreadable.
nas_free_kb() {
  local kb
  kb=$("${SSH[@]}" "$NAS_SSH" "d=$(printf '%q' "$NAS_ROOT"); while [ ! -d \"\$d\" ]; do d=\$(dirname \"\$d\"); done; df -Pk \"\$d\" | tail -1 | tr -s ' ' | cut -d' ' -f4")
  case $kb in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\t%s\n' "$kb" "$(date -Is)" | put "$CTL/nas.tsv"
  echo "$kb"
}
if ! nas_free_kb > /dev/null; then
  tick "cannot read free space on the NAS under $NAS_ROOT"
  exit 0
fi

# Runs a command in its own session and waits for it, checking the switch every
# two seconds. Returns 130 if the switch went off and the command was killed.
# `on_tick` runs every ~10 s while it waits, for progress.
killable() {
  setsid "$@" &
  local pid=$! n=0
  while kill -0 "$pid" 2>/dev/null; do
    if ! enabled; then
      kill -TERM -- "-$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 130
    fi
    sleep 2
    n=$((n + 1))
    [ $((n % 5)) -eq 0 ] && declare -F on_tick > /dev/null && on_tick
  done
  wait "$pid"
}

remote_size() { "${SSH[@]}" "$NAS_SSH" "stat -c %s $(printf '%q' "$1") 2>/dev/null || echo 0"; }

# 0 sent and verified, 1 failed, 130 switched off.
send_file() {
  local rel=$1 src="$LIB/$1" remote rq total have attempt rc l r started
  remote=$(remote_of "$rel")
  rq=$(printf '%q' "$remote")
  total=$(stat -c %s "$src")
  started=$(date -Is)

  "${SSH[@]}" "$NAS_SSH" "mkdir -p $(printf '%q' "$(dirname "$remote")")" \
    || { FAIL_MSG="cannot create $(dirname "$remote")"; return 1; }

  progress() { printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "$1" "$2" "$total" "$started" | put "$CTL/current.tsv"; }
  on_tick() { progress send "$(remote_size "$remote")"; }

  attempt=1
  while :; do
    have=$(remote_size "$remote"); have=${have:-0}
    [ "$have" -eq "$total" ] && break
    if [ "$have" -gt "$total" ]; then
      say "remote larger than local for $rel ($have > $total) -- truncating"
      "${SSH[@]}" "$NAS_SSH" ": > $rq"
      have=0
    fi
    [ "$attempt" -gt "$RETRIES" ] && { FAIL_MSG="gave up at $have/$total bytes after $RETRIES attempts"; return 1; }
    progress send "$have"
    say "send  $rel from $have/$total (attempt $attempt)"
    # tail -c +N is 1-indexed, so +have+1 starts at the first missing byte.
    killable bash -c 'tail -c +"$1" "$2" | ssh -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 "$3" "cat >> $4"' \
      _ "$((have + 1))" "$src" "$NAS_SSH" "$rq"
    rc=$?
    [ "$rc" -eq 130 ] && return 130
    [ "$rc" -ne 0 ] && { say "exit $rc on $rel -- retrying in 10s"; sleep 10; }
    attempt=$((attempt + 1))
  done

  # Both ends hashed at once. Checked twice before believing a mismatch: the NAS
  # has reported one on a file that was byte-identical ten seconds later.
  unset -f on_tick
  progress verify "$total"
  local tmp; tmp=$(mktemp -d)
  for try in 1 2; do
    killable bash -c 'md5sum "$1" | cut -d" " -f1 > "$2/l" & ssh -o BatchMode=yes "$3" "md5sum $4" | cut -d" " -f1 > "$2/r"; wait' \
      _ "$src" "$tmp" "$NAS_SSH" "$rq"
    rc=$?
    [ "$rc" -eq 130 ] && { rm -rf "$tmp"; return 130; }
    l=$(cat "$tmp/l" 2>/dev/null); r=$(cat "$tmp/r" 2>/dev/null)
    [ -n "$l" ] && [ "$l" = "$r" ] && break
    [ "$try" = 1 ] && { say "recheck $rel (local=$l remote=$r)"; sleep 10; }
  done
  rm -rf "$tmp"
  if [ -z "$l" ] || [ "$l" != "$r" ]; then
    # A wrong copy is worse than none: empty it, so the next run starts clean.
    "${SSH[@]}" "$NAS_SSH" ": > $rq"
    FAIL_MSG="checksum mismatch (local=$l remote=$r) -- remote emptied, will resend"
    return 1
  fi
  return 0
}

sent=0 failed=0
while IFS=$'\t' read -r size rel state; do
  [ -n "$rel" ] || continue
  enabled || break
  [ "$state" = ready ] || continue
  # The queue was built a moment ago; a file can have moved since.
  [ -f "$LIB/$rel" ] || continue

  free_kb=$(nas_free_kb) || { say "cannot read NAS free space -- stopping this run"; break; }
  if [ "$free_kb" -lt $(( size / 1024 + HEADROOM_GB * 1024 * 1024 )) ]; then
    recent full "$rel" "needs $((size / 1024 / 1024 / 1024))G, NAS has $((free_kb / 1024 / 1024))G free"
    continue
  fi

  FAIL_MSG=""
  send_file "$rel" < /dev/null
  case $? in
    0)
      printf '%s\n' "$rel" >> "$DONE"
      say "done  $rel"
      recent "done" "$rel" "$size bytes, md5 verified"
      sent=$((sent + 1))
      ;;
    130)
      say "pause $rel -- switched off"
      recent paused "$rel" "switched off mid-copy; resumes where it stopped"
      break
      ;;
    *)
      say "FAIL  $rel -- $FAIL_MSG"
      recent failed "$rel" "$FAIL_MSG"
      failed=$((failed + 1))
      ;;
  esac
  rm -f "$CTL/current.tsv"
done < <(cat "$CTL/queue.tsv")

rm -f "$CTL/current.tsv"
build_queue
nas_free_kb > /dev/null || true
if enabled; then
  tick "on — sent $sent, failed $failed, $(wc -l < "$CTL/queue.tsv") waiting"
else
  tick "off — $(wc -l < "$CTL/queue.tsv") file(s) waiting"
fi
exit 0
