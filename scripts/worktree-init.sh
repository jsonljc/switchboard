#!/usr/bin/env bash
# One-shot bootstrap for a fresh git worktree. Idempotent — safe to re-run.
# See docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md.
set -euo pipefail

common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "")"
git_dir="$(git rev-parse --git-dir 2>/dev/null || echo "")"

if [[ -z "$common_dir" || -z "$git_dir" ]]; then
  echo "[worktree-init] Not inside a git repository. Aborting." >&2
  exit 1
fi

common_abs="$(cd "$common_dir" 2>/dev/null && pwd -P || true)"
git_abs="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"

if [[ "$common_abs" == "$git_abs" ]]; then
  echo "[worktree-init] This is the primary worktree — nothing to do."
  exit 0
fi

worktree_root="$(git rev-parse --show-toplevel)"
repo_root="$(cd "$common_abs/.." && pwd -P)"

echo "[worktree-init] Bootstrapping worktree at $worktree_root"

# 1. Copy .env from repo root if missing.
if [[ -f "$worktree_root/.env" ]]; then
  echo "[worktree-init] .env already present — leaving it alone"
elif [[ -f "$repo_root/.env" ]]; then
  cp "$repo_root/.env" "$worktree_root/.env"
  echo "[worktree-init] Copied .env from $repo_root/.env"
else
  echo "[worktree-init] WARNING: no .env in $repo_root either."
  echo "[worktree-init]          Copy .env.example to .env and set required vars."
fi

# 2. Kill listeners on dev ports.
for port in 3000 3001 3002; do
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[worktree-init] Killing stale listener on :$port (PID $pids)"
    kill -9 $pids 2>/dev/null || true
  fi
done

# 3. DB sanity. Parse DATABASE_URL out of .env (shell `source` chokes on `&` in URLs).
if [[ -f "$worktree_root/.env" ]] && command -v pg_isready >/dev/null 2>&1; then
  db_url="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' "$worktree_root/.env" | tr -d '"' | tr -d "'")"
  if [[ -n "$db_url" ]]; then
    if pg_isready -d "$db_url" >/dev/null 2>&1; then
      echo "[worktree-init] Postgres reachable — running pnpm db:migrate"
      (cd "$worktree_root" && pnpm db:migrate) || {
        echo "[worktree-init] WARNING: pnpm db:migrate failed (continuing)"
      }
    else
      echo "[worktree-init] WARNING: Postgres is not reachable at the configured DATABASE_URL."
      echo "[worktree-init]          Start it (e.g. \`docker compose up postgres -d\`) then re-run."
    fi
  fi
fi

# 4. Print next steps.
cat <<EOF

[worktree-init] Done. Next steps:
  cd $worktree_root
  pnpm dev                    # starts api (:3000), chat (:3001), dashboard (:3002)
  open http://localhost:3002

EOF
