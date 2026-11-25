#!/usr/bin/env bash
# Weekly restore drill: prove both restic repositories can actually be restored,
# not just read. `restic check --read-data-subset` (Sundays, in the backup
# scripts) proves the bytes are there; this proves they turn back into a working
# database and intact photos.
#
#  box repo (sftp:NAS:/docker/homelab-backup)
#    every pg_dumpall in the latest snapshot -> a throwaway Postgres of the same
#    image as the live server -> each database must come back with tables, and
#    psql may print no ERROR beyond the expected "role already exists".
#  NAS repo (~/nas-backup/repo)
#    the newest Immich database dump -> a throwaway Immich Postgres (same image
#    as on the NAS) -> the asset table must have rows;
#    the newest accounts dump -> the user table must have rows;
#    PHOTO_SAMPLES random originals -> each must come back at its recorded size.
#
# Nothing touches a live container. Scratch space is ~/ops/restore-drill/work,
# wiped at the start and the end. Writes ~/ops/metrics/restore-drill.prom.
set -euo pipefail

STATE="$HOME/ops/restore-drill"
WORK="$STATE/work"
METRICS="$HOME/ops/metrics"
RESTIC_IMAGE="restic/restic:0.18.1"
PHOTO_SAMPLES=${PHOTO_SAMPLES:-5}
BOX_PASSWORD_FILE="$HOME/.config/homelab/restic-password"
NAS_HOST=$(ssh -G nas | awk '$1 == "hostname" { print $2 }')
NAS_USER=$(ssh -G nas | awk '$1 == "user" { print $2 }')

mkdir -p "$STATE" "$METRICS" "$HOME/.cache/restic"
exec 9>"$STATE/lock"; flock -n 9 || { echo "already running"; exit 0; }
started=$(date +%s)
declare -A results=()   # target -> 1 ok / 0 failed
failures=0

wipe_work() {
  # Restored files and Postgres data are root-owned: remove them from a container.
  if [ -d "$WORK" ]; then docker run --rm -v "$STATE:/s" alpine:3.22 rm -rf /s/work; fi
  mkdir -p "$WORK"
}

# restic restores as root and creates the parent directories root-only: hand them to us.
own_work() { docker run --rm -v "$WORK:/w" alpine:3.22 chown -R "$(id -u):$(id -g)" /w; }

write_metrics() {
  local code=$1 tmp="$METRICS/restore-drill.prom.$$" target
  docker ps -aq --filter label=homelab.restore-drill | xargs -r docker rm -f >/dev/null 2>&1 || true
  wipe_work || true
  {
    echo "# HELP homelab_restore_drill_last_run_timestamp_seconds Start of the last restore drill."
    echo "# TYPE homelab_restore_drill_last_run_timestamp_seconds gauge"
    echo "homelab_restore_drill_last_run_timestamp_seconds $started"
    echo "# HELP homelab_restore_drill_last_success_timestamp_seconds End of the last drill where every target restored."
    echo "# TYPE homelab_restore_drill_last_success_timestamp_seconds gauge"
    echo "homelab_restore_drill_last_success_timestamp_seconds $(cat "$STATE/last-success" 2>/dev/null || echo 0)"
    echo "# HELP homelab_restore_drill_last_exit_code Exit code of the last drill; 0 is success."
    echo "# TYPE homelab_restore_drill_last_exit_code gauge"
    echo "homelab_restore_drill_last_exit_code $code"
    echo "# HELP homelab_restore_drill_target_ok 1 if the target restored in the last drill, 0 if not."
    echo "# TYPE homelab_restore_drill_target_ok gauge"
    for target in "${!results[@]}"; do
      echo "homelab_restore_drill_target_ok{target=\"$target\"} ${results[$target]}"
    done
  } >"$tmp"
  mv "$tmp" "$METRICS/restore-drill.prom"
}
trap 'write_metrics $?' EXIT

ok()   { results[$1]=1; echo "OK   $1${2:+ -- $2}"; }
fail() { results[$1]=0; failures=$((failures + 1)); echo "FAIL $1${2:+ -- $2}" >&2; }

box_restic() {
  docker run --rm -i \
    -e RESTIC_REPOSITORY="sftp:$NAS_USER@$NAS_HOST:/docker/homelab-backup" \
    -e RESTIC_PASSWORD_FILE=/run/restic-password \
    -v "$BOX_PASSWORD_FILE:/run/restic-password:ro" \
    -v "$HOME/.ssh:/ssh:ro" \
    -v "$HOME/.cache/restic:/root/.cache/restic" \
    -v "$WORK:/work" \
    "$RESTIC_IMAGE" \
    -o sftp.command="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts -o ServerAliveInterval=20 -o ServerAliveCountMax=3 $NAS_USER@$NAS_HOST -s sftp" \
    "$@"
}

nas_restic() {
  docker run --rm -i --env-file "$HOME/.config/homelab/nas-restic.env" \
    -v "$HOME/nas-backup:/repo:ro" \
    -v "$HOME/.cache/restic:/root/.cache/restic" \
    -v "$WORK:/work" \
    "$RESTIC_IMAGE" -r /repo/repo --no-lock "$@"
}

# The image a dump should be restored into: the live server's, when it still
# runs (container or Swarm service of that name), else plain Postgres of the
# major version written in the dump's own header.
image_for() {
  local name=$1 dump=$2 image major
  image=$(docker inspect -f '{{.Config.Image}}' "$name" 2>/dev/null) \
    || image=$(docker service inspect -f '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "$name" 2>/dev/null) \
    || image=""
  if [ -z "$image" ]; then
    major=$(gunzip -c "$dump" | head -n 200 | sed -n 's/^-- Dumped from database version \([0-9]*\).*/\1/p' | head -n 1) || true
    image="postgres:${major:-17}-alpine"
  fi
  echo "${image%@sha256:*}"
}

# The superuser the live server was initialised with (POSTGRES_USER), so grants
# made "as" that role in the dump replay. postgres when the server is gone.
superuser_for() {
  local u
  u=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null | sed -n 's/^POSTGRES_USER=//p') || true
  echo "${u:-postgres}"
}

# Start a throwaway server, feed it the dump. $1 target name, $2 image, $3
# superuser, $4 gzip'd dump, $5 database to load it into (postgres for a
# pg_dumpall, which creates its own), $6 optional sed expression for the dump.
# Leaves the container running for the caller to inspect; psql's stderr is in
# $WORK/<target>.err.
restore_into() {
  local target=$1 image=$2 user=$3 dump=$4 db=$5 filter=${6:-} c="drill-$1"
  docker rm -f "$c" >/dev/null 2>&1 || true
  docker run -d --name "$c" --label homelab.restore-drill \
    -e POSTGRES_PASSWORD=drill -e POSTGRES_USER="$user" -e POSTGRES_DB="$db" \
    "$image" >/dev/null
  # The entrypoint runs a temporary server for initdb, then restarts: wait for the real one.
  for _ in $(seq 90); do
    if docker logs "$c" 2>&1 | grep -q 'init process complete' \
        && docker exec "$c" pg_isready -q -U "$user" -d "$db" 2>/dev/null; then
      break
    fi
    sleep 2
  done
  gunzip -c "$dump" | { if [ -n "$filter" ]; then sed "$filter"; else cat; fi; } \
    | docker exec -i "$c" psql -q -U "$user" -d "$db" -o /dev/null 2>"$WORK/$target.err" || true
}

# ERRORs other than the cluster's own superuser / default roles already existing.
unexpected_errors() {
  grep -E 'ERROR:|FATAL:|psql: error' "$WORK/$1.err" | grep -vc 'role "[^"]*" already exists' || true
}

# Keep a failed target's psql output past the end-of-run wipe, for debugging.
keep_errors() { mkdir -p "$STATE/errors"; cp "$WORK/$1.err" "$STATE/errors/$1.err" 2>/dev/null || true; }
first_error() { grep -E -m1 'ERROR:|FATAL:|psql: error' "$WORK/$1.err" | grep -v 'already exists' || true; }

wipe_work

# --- 1. Box: every Postgres dump in the latest snapshot.
box_restic restore latest --target /work/box --include /data/home/ops/backup/dumps >/dev/null
own_work
dumps=("$WORK"/box/data/home/ops/backup/dumps/*.sql.gz)
[ -e "${dumps[0]}" ] || { fail box-dumps "no dumps in the latest snapshot"; exit 1; }
for dump in "${dumps[@]}"; do
  name=$(basename "$dump" .sql.gz)
  target="pg:$name"
  image=$(image_for "$name" "$dump")
  user=$(superuser_for "$name")
  restore_into "$name" "$image" "$user" "$dump" postgres
  errors=$(unexpected_errors "$name")
  # Every database that is not a template or the default must have at least one user table.
  q() { docker exec "drill-$name" psql -U "$user" -Atc "$2" -d "$1" 2>/dev/null; }
  dblist=$(q postgres "select datname from pg_database where not datistemplate and datname <> 'postgres'" || true)
  dbs=0; empty=""
  for db in $dblist; do
    dbs=$((dbs + 1))
    n=$(q "$db" "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')" || echo 0)
    [ "${n:-0}" -gt 0 ] || empty="$empty $db"
  done
  [ "$dbs" -gt 0 ] || empty=" (no databases)"
  if [ "$errors" -eq 0 ] && [ -z "$empty" ]; then
    ok "$target" "$image, $dbs database(s)"
  else
    keep_errors "$name"
    fail "$target" "$image as $user: $errors unexpected error(s)${empty:+, empty:$empty}; first: $(first_error "$name")"
  fi
  docker rm -f "drill-$name" >/dev/null
done

# --- 2. NAS: the newest Immich database dump.
# Newest .sql.gz in a directory of the latest NAS snapshot (names sort by date).
newest_nas_dump() {
  nas_restic ls latest "$1" --json | python3 -c '
import json, sys
names = [n["path"] for n in map(json.loads, sys.stdin) if n.get("type") == "file" and n.get("path", "").endswith(".sql.gz")]
print(sorted(names)[-1] if names else "")'
}

immich_dump=$(newest_nas_dump /data/immich/backups)
if [ -z "$immich_dump" ]; then
  fail immich-db "no Immich dump in the latest NAS snapshot"
else
  nas_restic restore latest --target /work/nas --include "$immich_dump" >/dev/null
  own_work
  image=$(ssh nas "docker inspect -f '{{.Config.Image}}' immich_postgres")
  image=${image%@sha256:*}
  # Immich (v3) dumps only its own database, with --clean: load it into an empty
  # `immich`. Its restore procedure also undoes the dump's cleared search_path,
  # which the vector extensions need.
  restore_into immich "$image" postgres "$WORK/nas$immich_dump" immich \
    "s/SELECT pg_catalog.set_config('search_path', '', false);/SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', true);/g"
  assets=$(docker exec drill-immich psql -U postgres -d immich -Atc 'select count(*) from asset' 2>/dev/null \
    || docker exec drill-immich psql -U postgres -d immich -Atc 'select count(*) from assets' 2>/dev/null || echo 0)
  errors=$(unexpected_errors immich)
  if [ "${assets:-0}" -gt 0 ] && [ "$errors" -eq 0 ]; then
    ok immich-db "$(basename "$immich_dump"), $assets assets"
  else
    keep_errors immich
    fail immich-db "$(basename "$immich_dump"): $assets assets, $errors unexpected error(s); first: $(first_error immich)"
  fi
  docker rm -f drill-immich >/dev/null
fi

# --- 3. NAS: accounts' nightly pg_dump (single sign-on: users, sessions, invites).
accounts_dump=$(newest_nas_dump /data/accounts-backups)
if [ -z "$accounts_dump" ]; then
  fail accounts-db "no accounts dump in the latest NAS snapshot"
else
  nas_restic restore latest --target /work/nas --include "$accounts_dump" >/dev/null
  own_work
  image=$(ssh nas "docker inspect -f '{{.Config.Image}}' accounts-db")
  restore_into accounts "${image%@sha256:*}" accounts "$WORK/nas$accounts_dump" accounts
  users=$(docker exec drill-accounts psql -U accounts -d accounts -Atc 'select count(*) from "user"' 2>/dev/null || echo 0)
  errors=$(unexpected_errors accounts)
  if [ "${users:-0}" -gt 0 ] && [ "$errors" -eq 0 ]; then
    ok accounts-db "$(basename "$accounts_dump"), $users users"
  else
    keep_errors accounts
    fail accounts-db "$(basename "$accounts_dump"): $users users, $errors unexpected error(s); first: $(first_error accounts)"
  fi
  docker rm -f drill-accounts >/dev/null
fi

# --- 4. NAS: random original photos and videos, byte count against the snapshot's record.
nas_restic ls latest /data/immich/library --recursive --json \
  | python3 -c '
import json, random, sys
files = [n for n in map(json.loads, sys.stdin)
         if n.get("type") == "file" and n.get("size", 0) > 0 and "/thumbs/" not in n["path"]
         and n["path"].rsplit(".", 1)[-1].lower() in {"jpg","jpeg","heic","png","mp4","mov","dng","webp"}]
for n in random.sample(files, min(int(sys.argv[1]), len(files))):
    print(n["size"], n["path"])' "$PHOTO_SAMPLES" >"$WORK/photos.txt"
photos_ok=0; photos_total=0
while read -r size path; do
  photos_total=$((photos_total + 1))
  got=$(nas_restic dump latest "$path" </dev/null | wc -c)
  if [ "$got" -eq "$size" ]; then photos_ok=$((photos_ok + 1)); else echo "  $path: $got of $size bytes" >&2; fi
done <"$WORK/photos.txt"
if [ "$photos_total" -gt 0 ] && [ "$photos_ok" -eq "$photos_total" ]; then
  ok immich-photos "$photos_ok/$photos_total originals intact"
else
  fail immich-photos "$photos_ok/$photos_total originals intact"
fi

[ "$failures" -eq 0 ] || exit 1
date +%s >"$STATE/last-success"
