#!/usr/bin/env bash
# Deploy the status Worker from the Mac, with the Cloudflare API (no wrangler).
#   apps/status/worker/deploy.sh
# Idempotent. First run also creates the KV namespace, the ingest token (into the
# repo .env and the box's ~/.config/homelab/status.env) and the custom domain.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
set -a; . "$root/.env"; set +a

NAME=homelab-status
HOST=status.davideghiotto.it
API="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID"
cf() { curl -sS -H "Authorization: Bearer $CF_API_TOKEN" "$@"; }
ok() { python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0) if d.get("success") else sys.exit(json.dumps(d.get("errors")))'; }

# 1. KV namespace
ns=$(cf "$API/storage/kv/namespaces?per_page=100" | python3 -c "
import json,sys
print(next((n['id'] for n in json.load(sys.stdin)['result'] if n['title']=='$NAME'), ''))")
if [ -z "$ns" ]; then
  ns=$(cf -X POST -H 'Content-Type: application/json' -d "{\"title\":\"$NAME\"}" "$API/storage/kv/namespaces" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["id"])')
  echo "created KV namespace $ns"
fi

# 2. Script, with the page as a Text module. keep_bindings keeps the secret across deploys.
meta=$(printf '{"main_module":"worker.js","compatibility_date":"2025-09-01","bindings":[{"type":"kv_namespace","name":"STATUS","namespace_id":"%s"}],"keep_bindings":["secret_text"]}' "$ns")
cf -X PUT "$API/workers/scripts/$NAME" \
  -F "metadata=$meta;type=application/json" \
  -F "worker.js=@$here/worker.js;type=application/javascript+module" \
  -F "index.html=@$here/index.html;type=text/plain" | ok
echo "deployed $NAME"

# 3. Ingest token: generated once, kept in .env, pushed to the Worker and the box.
if [ -z "${STATUS_INGEST_TOKEN:-}" ]; then
  STATUS_INGEST_TOKEN=$(openssl rand -hex 32)
  printf '\n# status.davideghiotto.it: the box POSTs snapshots with this (apps/status)\nSTATUS_URL=https://%s\nSTATUS_INGEST_TOKEN=%s\n' "$HOST" "$STATUS_INGEST_TOKEN" >> "$root/.env"
  printf '{"name":"INGEST_TOKEN","text":"%s","type":"secret_text"}' "$STATUS_INGEST_TOKEN" \
    | cf -X PUT -H 'Content-Type: application/json' --data @- "$API/workers/scripts/$NAME/secrets" | ok
  printf '# status page ingest (apps/status). Same values in the homelab repo .env.\nSTATUS_URL=https://%s\nSTATUS_INGEST_TOKEN=%s\n' "$HOST" "$STATUS_INGEST_TOKEN" \
    | ssh homelab 'umask 077; cat > ~/.config/homelab/status.env'
  echo "ingest token created and installed"
fi

# 4. Custom domain (Cloudflare creates the DNS record and certificate).
cf -X PUT -H 'Content-Type: application/json' \
  -d "{\"hostname\":\"$HOST\",\"service\":\"$NAME\",\"environment\":\"production\",\"zone_id\":\"$CF_ZONE_ID\"}" \
  "$API/workers/domains" | ok
echo "https://$HOST"
