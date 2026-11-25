#!/usr/bin/env bash
# One-off: switch on CI's post-deploy verification (`.github/scripts/verify-deploy.py`).
# Run on the Mac, from the repo root:   bash tools/cloudflare/setup-deploy-verify.sh
#
# Until this has run, every deploy workflow's "verify" step says the secrets are
# missing and passes, so a deploy that leaves a service broken is still green.
#
# What it does, printing no secret:
#   1. a Cloudflare Access service token `github-deploy-verify` (1 year), and a
#      Service Auth policy for it on the `hub` Access app (monitoring.davideghiotto.it).
#      The token only gets CI past Cloudflare's edge: behind it the hub still wants
#      its password for everything except /api/checks, which wants the bearer below;
#   2. a random bearer for /api/checks;
#   3. GitHub secrets CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, HUB_CHECKS_TOKEN;
#   4. Mac Keychain copies (homelab-cf-deploy-verify, homelab-hub-checks-token),
#      and the line for the hub's Dokploy env on the clipboard.
# The one step left by hand is pasting that line into Dokploy and redeploying hub.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; . ./.env; set +a
: "${CF_API_TOKEN:?}" "${CF_ACCOUNT_ID:?}"
api="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access"
cf() { curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

app_id=$(cf "$api/apps" | json 'print(next(a["id"] for a in d["result"] if a.get("domain") == "monitoring.davideghiotto.it"))')

if cf "$api/service_tokens" | json 'sys.exit(0 if any(t["name"] == "github-deploy-verify" for t in d["result"]) else 1)'; then
  echo "service token github-deploy-verify already exists: its secret is shown only at creation."
  echo "Delete it in Zero Trust -> Access -> Service credentials and rerun, or set the two CF_ACCESS_* secrets by hand." >&2
  exit 1
fi

created=$(cf -X POST "$api/service_tokens" -d '{"name":"github-deploy-verify","duration":"8760h"}')
token_id=$(json 'print(d["result"]["id"])' <<<"$created")
client_id=$(json 'print(d["result"]["client_id"])' <<<"$created")
client_secret=$(json 'print(d["result"]["client_secret"])' <<<"$created")
unset created
echo "created Access service token github-deploy-verify"

cf -X POST "$api/apps/$app_id/policies" -d "$(python3 -c '
import json, sys
print(json.dumps({"name": "github-deploy-verify", "decision": "non_identity", "precedence": 2,
                  "include": [{"service_token": {"token_id": sys.argv[1]}}]}))' "$token_id")" >/dev/null \
  || { echo "policy not created: add a Service Auth policy for github-deploy-verify on the hub app by hand" >&2; }
echo "added Service Auth policy on the hub Access app"

checks_token=$(openssl rand -hex 32)

printf %s "$client_id" | gh secret set CF_ACCESS_CLIENT_ID
printf %s "$client_secret" | gh secret set CF_ACCESS_CLIENT_SECRET
printf %s "$checks_token" | gh secret set HUB_CHECKS_TOKEN

security add-generic-password -U -s homelab-cf-deploy-verify -a "$client_id" -w "$client_secret"
security add-generic-password -U -s homelab-hub-checks-token -a davide -w "$checks_token"
printf 'CHECKS_TOKEN=%s' "$checks_token" | pbcopy

cat <<'EOF'

Done. Last step, by hand:
  Dokploy (http://debian:3000) -> homelab -> hub -> Environment: paste the clipboard
  (a CHECKS_TOKEN=... line) at the end, Save, then Deploy.
Check: the next deploy run's "verify" step lists real checks instead of
"deploy verification skipped".
EOF
