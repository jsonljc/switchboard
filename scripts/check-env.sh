#!/usr/bin/env bash
# Predev hint: prints a one-line warning when .env is missing in a non-primary
# worktree. Non-blocking (always exits 0) — this is a hint, not a gate.
# See docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md.
set -euo pipefail

common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "")"
git_dir="$(git rev-parse --git-dir 2>/dev/null || echo "")"

if [[ -z "$common_dir" || -z "$git_dir" ]]; then
  exit 0
fi

common_abs="$(cd "$common_dir" 2>/dev/null && pwd -P || true)"
git_abs="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"

# In the primary worktree, common_dir == git_dir (both point to .git).
if [[ "$common_abs" == "$git_abs" ]]; then
  exit 0
fi

worktree_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$worktree_root" ]]; then
  exit 0
fi

if [[ ! -f "$worktree_root/.env" ]]; then
  echo ""
  echo "  ⚠ .env is missing in this worktree. Run \`pnpm worktree:init\` from"
  echo "    $worktree_root"
  echo ""
fi

exit 0
