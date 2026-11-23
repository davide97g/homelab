#!/usr/bin/env bash
# Nightly backup of the mini PC to the NAS, with restic, over sftp on Tailscale.
#
# restic runs in a container so it can read /var/lib/docker/volumes and
# /etc/dokploy as root without the box's sudo password. Everything it reads is
# mounted read-only. Postgres is never copied as live files: every running
# server is pg_dumpall'd first, and its data volume is then left out.
#
# Writes ~/ops/metrics/backup.prom for node_exporter's textfile collector, which
# is what the BackupFailed / BackupStale alerts read.
set -euo pipefail

STATE="$HOME/ops/backup"
DUMPS="$STATE/dumps"
METRICS="$HOME/ops/metrics"
PASSWORD_FILE="$HOME/.config/homelab/restic-password"
IMAGE="restic/restic:0.18.1"
# UGOS's sftp server roots at the shares: /docker is /volume1/docker.
REPO_PATH="/docker/homelab-backup"
# The NAS is only on the tailnet; take its address from the `nas` ssh alias.
NAS_HOST=$(ssh -G nas | awk '$1 == "hostname" { print $2 }')
NAS_USER=$(ssh -G nas | awk '$1 == "user" { print $2 }')

mkdir -p "$DUMPS" "$METRICS" "$HOME/.cache/restic"
exec 9>"$STATE/backup.lock"
flock -n 9 || { echo "another backup is running"; exit 0; }

started=$(date +%s)
added_bytes=0
dump_failures=0

write_metrics() {
  local code=$1 tmp="$METRICS/backup.prom.$$"
  local last_success
  last_success=$(cat "$STATE/last-success" 2>/dev/null || echo 0)
  cat >"$tmp" <<EOF
# HELP homelab_backup_last_run_timestamp_seconds Start of the last backup run.
# TYPE homelab_backup_last_run_timestamp_seconds gauge
homelab_backup_last_run_timestamp_seconds $started
# HELP homelab_backup_last_success_timestamp_seconds End of the last run that exited 0.
# TYPE homelab_backup_last_success_timestamp_seconds gauge
homelab_backup_last_success_timestamp_seconds $last_success
# HELP homelab_backup_last_exit_code Exit code of the last run; 0 is success.
# TYPE homelab_backup_last_exit_code gauge
homelab_backup_last_exit_code $code
# HELP homelab_backup_last_duration_seconds Wall time of the last run.
# TYPE homelab_backup_last_duration_seconds gauge
homelab_backup_last_duration_seconds $(( $(date +%s) - started ))
# HELP homelab_backup_last_added_bytes New data the last run sent to the repository.
# TYPE homelab_backup_last_added_bytes gauge
homelab_backup_last_added_bytes $added_bytes
# HELP homelab_backup_dump_failures Postgres servers whose dump failed in the last run.
# TYPE homelab_backup_dump_failures gauge
homelab_backup_dump_failures $dump_failures
EOF
  mv "$tmp" "$METRICS/backup.prom"
}
trap 'write_metrics $?' EXIT

restic() {
  docker run --rm -i \
    --hostname debian \
    -e RESTIC_REPOSITORY="sftp:$NAS_USER@$NAS_HOST:$REPO_PATH" \
    -e RESTIC_PASSWORD_FILE=/run/restic-password \
    -v "$PASSWORD_FILE:/run/restic-password:ro" \
    -v "$HOME/.ssh:/ssh:ro" \
    -v "$HOME/.cache/restic:/root/.cache/restic" \
    -v /home/davide:/data/home:ro \
    -v /var/lib/docker/volumes:/data/volumes:ro \
    -v /etc/dokploy:/data/dokploy:ro \
    "$IMAGE" \
    -o sftp.command="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts -o ServerAliveInterval=20 -o ServerAliveCountMax=3 $NAS_USER@$NAS_HOST -s sftp" \
    "$@"
}

# --- 1. Postgres: dump every running server, remember which volumes are covered.
# A server is a container answering pg_isready on its own socket; the backup
# sidecars (lumii-backup, finance's postgres-backup-local) have the client but
# no server, so they fail it and are skipped.
pg_volume_excludes=()
for id in $(docker ps -q); do
  name=$(docker inspect -f '{{.Name}}' "$id" | sed 's|^/||; s|\.[0-9]*\.[a-z0-9]*$||')
  volume=$(docker inspect -f '{{range .Mounts}}{{if and (eq .Type "volume") (or (eq .Destination "/var/lib/postgresql/data") (eq .Destination "/var/lib/postgresql"))}}{{.Name}}{{end}}{{end}}' "$id")
  [ -n "$volume" ] || continue
  docker exec "$id" pg_isready -q 2>/dev/null || continue
  out="$DUMPS/$name.sql.gz"
  if docker exec "$id" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' | gzip -6 >"$out.tmp" \
      && [ -s "$out.tmp" ]; then
    mv "$out.tmp" "$out"
    pg_volume_excludes+=(--exclude "/data/volumes/$volume")
    echo "dumped $name ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.tmp"
    dump_failures=$((dump_failures + 1))
    # Keep the raw volume in the snapshot: crash-consistent beats nothing.
    echo "DUMP FAILED: $name -- its volume $volume is backed up as files instead" >&2
  fi
done

# --- 2. One snapshot of everything that is not rebuildable.
summary=$(restic backup --json --tag nightly \
  /data/home /data/volumes /data/dokploy \
  --exclude-caches \
  --exclude '/data/home/media' \
  --exclude '/data/home/Downloads' \
  --exclude '/data/home/.cache' \
  --exclude '/data/home/.local/share/Trash' \
  --exclude '/data/home/ciamioncino/overpass-db' \
  --exclude '/data/home/ciamioncino/builder-cache' \
  --exclude '/data/home/ciamioncino/downloads' \
  --exclude '/data/home/atlante/tiles' \
  --exclude '/data/home/atlante/valhalla' \
  --exclude '/data/home/echo-demo/hf' \
  --exclude 'node_modules' \
  --exclude '.venv' \
  --exclude '/data/volumes/ollama' \
  --exclude '/data/volumes/*prometheus-data' \
  --exclude '/data/volumes/*loki-data' \
  --exclude '/data/volumes/mon-test_*' \
  --exclude '/data/volumes/mediarr_jellyfin-cache' \
  --exclude '/data/dokploy/logs' \
  "${pg_volume_excludes[@]}" | tail -n 1)
added_bytes=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("data_added", 0))' "$summary")
echo "snapshot done, $added_bytes bytes added"

# --- 3. Retention, and on Sundays a prune and a partial read-back.
restic forget --tag nightly --keep-daily 7 --keep-weekly 5 --keep-monthly 12
if [ "$(date +%u)" = 7 ]; then
  restic prune
  restic check --read-data-subset=5%
fi

date +%s >"$STATE/last-success"
# A failed dump is a failed run, even though the snapshot itself went through.
[ "$dump_failures" -eq 0 ]
