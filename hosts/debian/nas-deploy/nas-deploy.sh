#!/usr/bin/env bash
# Push-to-deploy for the NAS apps, pulled from the box.
#
# GitHub cannot reach the NAS and Dokploy has no root Docker there, so the NAS
# apps used to be deployed by hand from the Mac (tar over ssh). This runs on the
# box every 5 minutes instead: it fetches main from the public repo and, for
# each app whose folder changed since its last deploy, exports exactly that
# commit (`git archive`, so nothing untracked rides along), sends it to the NAS
# over the box's ssh alias, starts it and checks it answers. Same contract as
# the Dokploy apps: what is on main is what runs.
#
#   nas-deploy.sh                 deploy whatever changed on main
#   nas-deploy.sh --force <app>   deploy <app> at main even if unchanged
#   nas-deploy.sh --status        print each app's deployed commit
#
# Apps: cinema, memories, accounts, nas-agents. Their NAS folders are all under
# /volume1/docker: a UGOS update resets the root overlay, /home included
# (2026-11-08). Files that git does not track there (.env, pgdata, backups,
# pipeline/) are never touched: tar only adds and overwrites.
#
# Writes ~/ops/metrics/nas-deploy.prom for NasDeployFailed / NasDeployLoopStale.
set -euo pipefail

STATE="$HOME/ops/nas-deploy"
REPO="$STATE/repo"
METRICS="$HOME/ops/metrics"
ORIGIN="https://github.com/davide97g/homelab.git"
APPS=(cinema memories accounts nas-agents)

# --- Per-app state: <app>.sha (deployed commit), .code (last exit), .ok (last success time).
write_metrics() {
  local tmp="$METRICS/nas-deploy.prom.$$" app
  {
    echo "# HELP homelab_nas_deploy_last_check_timestamp_seconds Last time the NAS deploy loop looked at main."
    echo "# TYPE homelab_nas_deploy_last_check_timestamp_seconds gauge"
    echo "homelab_nas_deploy_last_check_timestamp_seconds $(cat "$STATE/last-check" 2>/dev/null || echo 0)"
    echo "# HELP homelab_nas_deploy_last_exit_code Exit code of the app's last NAS deploy; 0 is success."
    echo "# TYPE homelab_nas_deploy_last_exit_code gauge"
    for app in "${APPS[@]}"; do
      echo "homelab_nas_deploy_last_exit_code{app=\"$app\"} $(cat "$STATE/apps/$app.code" 2>/dev/null || echo 0)"
    done
    echo "# HELP homelab_nas_deploy_last_success_timestamp_seconds End of the app's last successful NAS deploy."
    echo "# TYPE homelab_nas_deploy_last_success_timestamp_seconds gauge"
    for app in "${APPS[@]}"; do
      echo "homelab_nas_deploy_last_success_timestamp_seconds{app=\"$app\"} $(cat "$STATE/apps/$app.ok" 2>/dev/null || echo 0)"
    done
  } >"$tmp"
  mv "$tmp" "$METRICS/nas-deploy.prom"
}
src_of() {
  case $1 in
    cinema)     echo apps/cinema ;;
    memories)   echo apps/memories ;;
    accounts)   echo apps/accounts ;;
    nas-agents) echo apps/monitoring/nas-agents ;;
  esac
}
dir_of() {
  case $1 in
    nas-agents) echo /volume1/docker/nas-agents ;;
    *)          echo "/volume1/docker/$1" ;;
  esac
}

# Export <app>'s folder at HEAD_SHA into a fresh temp dir, folder contents at its root.
export_app() {
  local app=$1 src out
  src=$(src_of "$app"); out=$(mktemp -d "$STATE/export.XXXXXX")
  # The vendored iOS/Android apps are 38 MB the web image never reads.
  git -C "$REPO" archive "$HEAD_SHA" -- "$src" ":(exclude)$src/apps/ios" ":(exclude)$src/apps/android" \
    | tar -x -C "$out" --strip-components="$(awk -F/ '{print NF}' <<<"$src")"
  echo "$out"
}

# Send a local folder's contents into the NAS folder. Not scp/rsync: UGOS's sftp
# is chrooted to the shares and rsync is not installed.
ship() {
  local from=$1 dir=$2
  ssh -o BatchMode=yes nas "mkdir -p '$dir'"
  COPYFILE_DISABLE=1 tar czf - -C "$from" . | ssh -o BatchMode=yes nas "tar xzf - -C '$dir'"
}

nas() { ssh -o BatchMode=yes nas "$@"; }

# Poll a command on the NAS until it succeeds, for up to $1 seconds.
wait_for() {
  local secs=$1; shift
  for _ in $(seq $((secs / 5))); do
    nas "$@" >/dev/null 2>&1 && return 0
    sleep 5
  done
  nas "$@"
}

deploy_cinema() {
  local out=$1 dir=$2
  ship "$out" "$dir"
  nas "cd '$dir/services/web' && docker compose up -d --build --remove-orphans"
  wait_for 120 "curl -fsS -o /dev/null http://localhost:8898/ && curl -fsS http://localhost:8898/jf/System/Info/Public | grep -q ServerName"
}

deploy_memories() {
  local out=$1 dir=$2
  # The SPA is built here, on the box: the NAS serves web/dist as plain files.
  (cd "$out/web" && bun install --frozen-lockfile --silent && bun run build >/dev/null)
  local pack; pack=$(mktemp -d "$STATE/pack.XXXXXX")
  (cd "$out" && tar cf - compose.yaml nginx.conf upload-relay/relay.py search/search.py web/dist) | tar xf - -C "$pack"
  ship "$pack" "$dir"
  rm -rf "$pack"
  # Files created under /volume1/docker inherit UGOS's share ACL, which locks out
  # nginx's worker (uid 101): the SPA answered 500 "Permission denied" until this
  # was stripped (2026-11-25, first deploy out of /home).
  nas "setfacl -bR '$dir' && chmod -R u=rwX,go=rX '$dir'"
  # Recreate: nginx.conf and the Python files are bind mounts read at start.
  nas "cd '$dir' && docker compose up -d --force-recreate --remove-orphans"
  wait_for 120 "curl -fsS -o /dev/null http://127.0.0.1:2284/ && curl -fsS http://127.0.0.1:2284/immich/api/server/ping | grep -q pong"
}

deploy_accounts() {
  local out=$1 dir=$2
  ship "$out" "$dir"
  nas "cd '$dir' && docker compose up -d --build --remove-orphans"
  wait_for 120 "curl -fsS http://127.0.0.1:2290/api/health | grep -q '\"ok\":true'"
}

deploy_nas_agents() {
  local out=$1 dir=$2
  # 700 and .env 600 every time: UGOS's share ACL makes new files world-writable.
  nas "mkdir -p '$dir' && chmod 700 '$dir' && (setfacl -b '$dir' 2>/dev/null; true) && if [ -f '$dir/.env' ]; then chmod 600 '$dir/.env'; fi"
  ship "$out" "$dir"
  nas "cd '$dir' && docker compose --profile logs up -d --remove-orphans"
  wait_for 60 "test \$(cd '$dir' && docker compose --profile logs ps --status running -q | wc -l) -ge 4"
}

deploy() {
  local app=$1 out dir code=0
  dir=$(dir_of "$app")
  echo "deploying $app at ${HEAD_SHA:0:12} to $dir"
  out=$(export_app "$app")
  # The step runs as a child process of this script, not a function call: deploy
  # is itself called in an `||` list, where bash ignores set -e in everything
  # beneath -- subshells included -- so a failed build would carry on and ship.
  "$0" --run "$app" "$out" "$dir" || code=$?
  rm -rf "$out"
  echo "$code" >"$STATE/apps/$app.code"
  if [ "$code" -eq 0 ]; then
    echo "$HEAD_SHA" >"$STATE/apps/$app.sha"
    date +%s >"$STATE/apps/$app.ok"
    rm -f "$STATE/apps/$app.failed"
    echo "$app deployed"
  else
    echo "$HEAD_SHA" >"$STATE/apps/$app.failed"
    echo "$app FAILED (exit $code); retried when main moves, or with --force" >&2
  fi
  return "$code"
}

# Child mode, from deploy(): one app's step, with set -e in full force.
if [ "${1:-}" = --run ]; then
  "deploy_${2//-/_}" "$3" "$4"
  exit 0
fi

mkdir -p "$STATE/apps" "$METRICS"
exec 9>"$STATE/lock"; flock -n 9 || { echo "already running"; exit 0; }

trap write_metrics EXIT

# --- The checkout: a clone of the public repo, only ever fast-forwarded to origin/main.
if [ ! -d "$REPO/.git" ]; then
  git clone --quiet --filter=blob:none "$ORIGIN" "$REPO"
fi
git -C "$REPO" fetch --quiet origin main
HEAD_SHA=$(git -C "$REPO" rev-parse origin/main)

if [ "${1:-}" = --status ]; then
  for app in "${APPS[@]}"; do
    sha=$(cat "$STATE/apps/$app.sha" 2>/dev/null || echo none)
    printf '%-11s %s  exit %s\n' "$app" "${sha:0:12}" "$(cat "$STATE/apps/$app.code" 2>/dev/null || echo -)"
  done
  exit 0
fi

if [ "${1:-}" = --force ]; then
  app=${2:?usage: nas-deploy.sh --force <app>}
  src_of "$app" | grep -q . || { echo "unknown app $app" >&2; exit 2; }
  deploy "$app"
  exit $?
fi

failed=0
for app in "${APPS[@]}"; do
  last=$(cat "$STATE/apps/$app.sha" 2>/dev/null || true)
  if [ -z "$last" ]; then
    # First run: what is on the NAS was checked against main by hand at install
    # time (install.sh), so start from here rather than redeploy everything.
    echo "$HEAD_SHA" >"$STATE/apps/$app.sha"
    echo "$app: starting at ${HEAD_SHA:0:12}"
    continue
  fi
  [ "$last" = "$HEAD_SHA" ] && continue
  # Unchanged folder: just move the marker. A commit the clone no longer has
  # (history rewritten) counts as changed.
  if git -C "$REPO" cat-file -e "$last^{commit}" 2>/dev/null \
      && git -C "$REPO" diff --quiet "$last" "$HEAD_SHA" -- "$(src_of "$app")"; then
    echo "$HEAD_SHA" >"$STATE/apps/$app.sha"
    continue
  fi
  # A failed app keeps its old sha and is not rebuilt every 5 minutes at the
  # same commit: it is tried again when main moves. NasDeployFailed pages meanwhile.
  [ "$(cat "$STATE/apps/$app.failed" 2>/dev/null)" = "$HEAD_SHA" ] && { failed=1; continue; }
  deploy "$app" || failed=1
done
date +%s >"$STATE/last-check"
exit "$failed"
