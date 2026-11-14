#!/bin/bash
# Announce a finished production deploy so an after-deploy check (docs/smoke-checklist.md)
# can start. Run it right after `wrangler deploy` succeeds:
#
#   scripts/deploy-notify.sh https://studio.example.com
#
# Posts {repo, kind: "deploy", sha, url, message} as JSON. The endpoint and its bearer key
# come from the environment and are never stored in the repo:
#   DEPLOY_HOOK_URL / DEPLOY_HOOK_AUTH   (falls back to OPPO_WEBHOOK_URL / OPPO_WEBHOOK_AUTH)
# With no endpoint set it does nothing and exits 0, so self-hosters can ignore it.
set -euo pipefail

url="${1:?usage: deploy-notify.sh <deployed-origin>}"
hook="${DEPLOY_HOOK_URL:-${OPPO_WEBHOOK_URL:-}}"
auth="${DEPLOY_HOOK_AUTH:-${OPPO_WEBHOOK_AUTH:-}}"
if [ -z "$hook" ]; then
  echo "deploy-notify: no hook configured, skipping"
  exit 0
fi

sha="$(git rev-parse HEAD)"
repo="$(basename "$(git rev-parse --show-toplevel)")"
subject="$(git log -1 --format=%s)"

jq -n --arg repo "$repo" --arg sha "$sha" --arg url "$url" \
  --arg msg "Deployed ${sha:0:7} to $url: $subject" \
  '{repo: $repo, kind: "deploy", sha: $sha, url: $url, message: $msg}' |
  curl -sS -o /dev/null -w "deploy-notify: %{http_code}\n" -X POST "$hook" \
    ${auth:+-H "Authorization: Bearer $auth"} -H "Content-Type: application/json" -d @-
