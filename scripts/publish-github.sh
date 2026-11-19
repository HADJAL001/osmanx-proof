#!/usr/bin/env bash
set -euo pipefail
OWNER="${1:-HADJAL001}"
REPO="${2:-osmanx-proof}"
cd "$(dirname "$0")/.."
command -v git >/dev/null || { echo 'git is required'; exit 1; }
command -v gh >/dev/null || { echo 'GitHub CLI (gh) is required'; exit 1; }
command -v node >/dev/null || { echo 'Node.js is required'; exit 1; }
node scripts/github-preflight.mjs
gh auth status
test -z "$(git status --porcelain)" || { echo 'Worktree is not clean'; exit 1; }
TARGET="$OWNER/$REPO"
if gh repo view "$TARGET" --json nameWithOwner >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$TARGET.git"
  git push -u origin main
else
  gh repo create "$TARGET" --private --source . --remote origin --push
fi
git push origin --tags
git push -u origin feature/r6-evidence-vault
echo "Published: https://github.com/$TARGET"
