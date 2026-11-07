#!/usr/bin/env bash
# Keep one comment on the pull request listing the changes no test caught (what
# scripts/mutants.ts wrote to --out DIR), and delete it once every one is caught.
# Usage: scripts/mutants-comment.sh DIR
# Needs GH_TOKEN, GITHUB_REPOSITORY, PR and RUN; FORK=true only summarizes.
set -euo pipefail
results=${1:?Usage: scripts/mutants-comment.sh DIR}
marker='<!-- mutants -->'
lived=$(cat "$results/lived.txt" 2>/dev/null || true)
tally=$(cat "$results/tally.txt" 2>/dev/null || echo "0 of 0")
body="$marker
**Mutation testing:** $tally changes caught by a test.

\`\`\`
$lived
\`\`\`

Each one is a change to the code no test noticed. Not a blocker: real gaps get their own PR. [Full report]($RUN)"
# Keep complete lines and balance the fence before linking the artifact.
if (( $(LC_ALL=C printf '%s' "$body" | wc -c) > 60000 )); then
  body=$(LC_ALL=C awk 'BEGIN { size = 0; fenced = 0 } {
    if (size + length($0) + 1 > 58000) exit
    print; size += length($0) + 1
    if ($0 ~ /^```/) fenced = !fenced
  } END { if (fenced) print "```" }' <<< "$body")
  body+=$'\n\n'"Report trimmed. [Full report artifact]($RUN#artifacts)"
fi
[[ -z $lived ]] || printf '%s\n' "$body" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
[[ ${FORK:-false} != true ]] || exit 0
old=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" | head -n 1)
if [[ -z $lived ]]; then
  if [[ -n $old ]]; then gh api -X DELETE "repos/$GITHUB_REPOSITORY/issues/comments/$old"; fi
elif [[ -n $old ]]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$old" -f body="$body" >/dev/null
else
  gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -f body="$body" >/dev/null
fi
