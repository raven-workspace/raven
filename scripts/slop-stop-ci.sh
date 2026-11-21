#!/usr/bin/env bash
# Runs the slop-stop hooks in .githooks against a range of commits, for CI: a local hook can be skipped
# (--no-verify, never running npm install, editing on github.com), this can't.
#
#   scripts/slop-stop-ci.sh <base> <head>
#
# Every commit in base..head has its message checked by .githooks/commit-msg, and the files the range adds or
# changes are checked by .githooks/pre-commit. Needs a full clone (fetch-depth: 0). The checkout isn't touched.
set -euo pipefail

base=$(git rev-parse --verify "${1:?base commit}^{commit}")
head=$(git rev-parse --verify "${2:?head commit}^{commit}")
failed=0

# Only the commits this range adds, not ones the base branch already has.
from=$(git merge-base "$base" "$head")

msg=$(mktemp)
tree=$(mktemp -d)
hooks=$(mktemp -d)
trap 'rm -f "$msg"; git worktree remove --force "$tree" 2>/dev/null || true; rm -rf "$tree" "$hooks"' EXIT

# The hooks come from the base, so a change can't weaken the hooks that judge it. Only a range that first adds
# them (the base has none) uses its own.
hook_src=$from
git cat-file -e "$from:.githooks/commit-msg" 2>/dev/null || hook_src=$head
for h in commit-msg pre-commit; do
  git show "$hook_src:.githooks/$h" >"$hooks/$h"
  chmod +x "$hooks/$h"
done
for c in $(git rev-list --reverse "$from..$head"); do
  git log -1 --format=%B "$c" >"$msg"
  if ! out=$("$hooks/commit-msg" "$msg" 2>&1); then
    echo "Commit $(git log -1 --format='%h %s' "$c"):"
    echo "$out"
    echo
    failed=1
  fi
done

# pre-commit reads the staged changes. In a throwaway worktree at the merge base, stage <head>'s tree: then
# `git diff --cached` lists exactly what the range adds or changes.
git worktree add -q --detach "$tree" "$from"
git -C "$tree" read-tree "$head"
if ! out=$(cd "$tree" && "$hooks/pre-commit" 2>&1); then
  echo "Files added in this range:"
  echo "$out"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo
  echo "slop-stop: fix the commits above (git rebase -i to reword, git rm --cached for files). --no-verify does not apply here."
  exit 1
fi
echo "slop-stop: $(git rev-list --count "$from..$head") commit(s) clean."
