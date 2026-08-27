#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL="https://github.com/SpiderNic96/dimensions-toypad-aio.git"
COMMIT_MESSAGE="Import complete 3.3.11 source and release structure"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed." >&2
  exit 1
fi

if [ ! -f README.md ] || [ ! -d source ] || [ ! -d .github/workflows ]; then
  echo "ERROR: run this script from the repository root." >&2
  exit 1
fi

if [ ! -d .git ]; then
  git init
  git branch -M main
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git add --all

echo
git status --short

echo
read -r -p "Commit and push these changes to main? [y/N] " answer
case "$answer" in
  y|Y|yes|YES)
    git commit -m "$COMMIT_MESSAGE" || true
    git pull --rebase origin main || true
    git push -u origin main
    ;;
  *)
    echo "Cancelled. Files remain staged." 
    ;;
esac
