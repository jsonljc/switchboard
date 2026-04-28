#!/usr/bin/env bash
# Warn when a docs-only commit on a feature branch touches spec/plan files
# whose names reference a different feature.
#
# Triggers a leak we hit in practice: an agent or session committed
# `docs/superpowers/specs/2026-04-28-fix-launch-billing-feature-gating-design.md`
# while sitting on `fix/launch-webhook-provisioning`, polluting that branch's
# diff with twelve unrelated spec commits.
#
# Behavior: warning only (does not block). Skips main and chore/* branches.
set -euo pipefail

branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
case "$branch" in
  main|master|"") exit 0 ;;
  chore/*|docs/*) exit 0 ;;
esac

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

# Only run when every staged file is a spec or plan markdown.
docs_only=1
while IFS= read -r f; do
  case "$f" in
    docs/superpowers/specs/*|docs/superpowers/plans/*) ;;
    *) docs_only=0; break ;;
  esac
done <<< "$staged"
[ "$docs_only" -eq 1 ] || exit 0

# Extract the branch's distinguishing slug (e.g. fix/launch-billing-foo -> billing).
slug=$(echo "$branch" | sed -E 's|^[^/]+/||; s|^launch-||; s|-.*$||')
[ -z "$slug" ] && exit 0

# Look for a spec/plan file that does NOT mention the slug.
mismatch=""
while IFS= read -r f; do
  if ! echo "$f" | grep -qi "$slug"; then
    mismatch="$mismatch  $f\n"
  fi
done <<< "$staged"

if [ -n "$mismatch" ]; then
  echo ""
  echo "warning: docs-only commit on branch '$branch' touches spec/plan files"
  echo "         that don't reference its slug ('$slug'):"
  printf "$mismatch"
  echo "         If these specs belong to other workstreams, switch branches"
  echo "         before committing. To proceed anyway, re-run the commit."
  echo ""
fi

exit 0
