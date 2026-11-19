#!/usr/bin/env bash
# Publish dist/ to Cloudflare Pages.
#
# Two wins over the wrangler-action step: the whole script is not echoed into
# the log, and a rejected token or a wrong account id is reported by name
# instead of surfacing as a bare "deploy failed".
set -uo pipefail

: "${PAGES_PROJECT:?PAGES_PROJECT must be set}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "::error::secrets.CLOUDFLARE_API_TOKEN is not set on this repo."
  exit 1
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "::error::secrets.CLOUDFLARE_ACCOUNT_ID is not set on this repo."
  exit 1
fi

TOKEN="$(printf '%s' "${CLOUDFLARE_API_TOKEN}" | tr -d '[:space:]')"
ACCOUNT="$(printf '%s' "${CLOUDFLARE_ACCOUNT_ID}" | tr -d '[:space:]')"

echo "token length ${#TOKEN}, account id length ${#ACCOUNT} (expect 32 for the account id)"

api() {
  url="$1"
  out="$2"
  curl -sS -o "${out}" -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" "${url}"
}

code="$(api https://api.cloudflare.com/client/v4/user/tokens/verify /tmp/verify.json)"
echo "token verify: HTTP ${code}"
cat /tmp/verify.json
 echo
if [ "${code}" != "200" ]; then
  echo "::error::Cloudflare rejected CLOUDFLARE_API_TOKEN. Create a new token at My Profile -> API Tokens and paste it into the CLOUDFLARE_API_TOKEN secret."
  exit 1
fi

code="$(api "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PAGES_PROJECT}" /tmp/project.json)"
echo "pages project ${PAGES_PROJECT}: HTTP ${code}"
cat /tmp/project.json
echo
if [ "${code}" = "403" ]; then
  echo "::error::The token is valid but may not use Cloudflare Pages on this account. Give it Account -> Cloudflare Pages: Edit and include this account under Account Resources."
  exit 1
fi
if [ "${code}" != "200" ]; then
  echo "::error::Could not read Pages project ${PAGES_PROJECT} with this token and account id. Check CLOUDFLARE_ACCOUNT_ID."
  exit 1
fi

npx --yes wrangler@4 pages deploy dist \
  --project-name="${PAGES_PROJECT}" \
  --branch=main \
  --commit-dirty=true >/tmp/deploy.log 2>&1
status=$?

echo "wrangler exit ${status}"
tail -n 40 /tmp/deploy.log

if [ "${status}" -ne 0 ]; then
  echo "::error::wrangler pages deploy failed - see the last lines above."
fi
exit "${status}"
