#!/usr/bin/env bash
# Clone every frontend Apex repo into dist/apps/<slug>/.
# Lives in a file rather than a `run:` block so the workflow log stays short
# enough to read the deploy error at the end of it.
set -euo pipefail

: "${APEX_OWNER:?APEX_OWNER must be set}"

if [ -z "${APEX_REPOS_TOKEN:-}" ]; then
  echo "::error::secrets.APEX_REPOS_TOKEN is not set. Add a fine-grained PAT with read access to the Apex repos."
  exit 1
fi

# A token pasted with a trailing newline or space goes into the clone URL
# verbatim, and GitHub rejects it as "Invalid username or token".
TOKEN="$(printf '%s' "${APEX_REPOS_TOKEN}" | tr -d '[:space:]')"
if [ -z "${TOKEN}" ]; then
  echo "::error::secrets.APEX_REPOS_TOKEN is empty after trimming whitespace."
  exit 1
fi

mkdir -p dist/apps
failed=0
first_failure=''

while read -r repo slug; do
  [ -n "${repo}" ] || continue
  target="dist/apps/${slug}"
  rm -rf "${target}"

  if git -c advice.detachedHead=false clone --depth 1 --quiet \
       "https://x-access-token:${TOKEN}@github.com/${APEX_OWNER}/${repo}.git" \
       "${target}"; then
    rm -rf "${target}/.git" "${target}/.github"
    echo "bundled ${repo} ($(find "${target}" -type f | wc -l) files)"
  else
    echo "::error::Could not clone ${APEX_OWNER}/${repo}. Check the token scope, the repo name and that it has a default branch."
    [ -n "${first_failure}" ] || first_failure="${repo}"
    failed=1
  fi
done <<'ROSTER'
The-Apex-Ai ai
Apex-Studio studio
Apex-Editor editor
Apex-Browser browser
Apex-Search search
Apex-Notrack notrack
Apex-Drive drive
Apex-Docs docs
Apex-Notes notes
Apex-Planner planner
Apex-Drop drop
Apex-Gallery gallery
Apex-Camera camera
Apex-Voice voice
Apex-Video video
Apex-Archive archive
Apex-Links links
Apex-Backup backup
Apex-Vault vault
Apex-Shield shield
Apex-Sec sec
Apex-Auth auth
Apex-Ledger ledger
Apex-Feed feed
Apex-Pulse pulse
Automation automation
Apex-Store store
Apex-Settings settings
ROSTER

if [ "${failed}" -ne 0 ]; then
  if [ "${first_failure}" != "The-Apex-Ai" ]; then
    echo "::error::APEX_REPOS_TOKEN was rejected for ${first_failure}. Check the token is not expired, that Repository access covers every Apex repo, that it has Contents: Read-only, and that it is a secret on this repo named exactly APEX_REPOS_TOKEN."
  fi
  echo "::error::At least one app repo failed to clone - refusing to deploy a partial build."
  exit 1
fi

echo "Bundled $(find dist/apps -mindepth 1 -maxdepth 1 -type d | wc -l) apps into dist/apps/."
