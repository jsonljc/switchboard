#!/usr/bin/env bash
# One-shot bootstrap for a fresh git worktree. Idempotent — safe to re-run.
# See docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md.
set -euo pipefail
trap 'echo "" >&2; echo "[worktree-init] Bootstrap failed (see error above). DB may be partial — run \`pnpm db:migrate && pnpm db:seed\` to retry, or \`pnpm local:setup\` for full bootstrap." >&2' ERR

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

# 1. Ensure .env exists (delegates worktree-copy + secret-generation to setup-env.sh).
(cd "$worktree_root" && bash scripts/setup-env.sh)

# 2. Kill listeners on dev ports.
for port in 3000 3001 3002; do
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[worktree-init] Killing stale listener on :$port (PID $pids)"
    kill -9 $pids 2>/dev/null || true
  fi
done

# 3. DB-dependent setup: migrate (fatal on failure), then build, then seed.
#    Skipped (exit 0 with explicit message) when DB is unreachable so devs
#    can re-run after starting Postgres.
db_reachable=false
if [[ -f "$worktree_root/.env" ]] && command -v pg_isready >/dev/null 2>&1; then
  db_url="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' "$worktree_root/.env" | tr -d '"' | tr -d "'")"
  # Strip the query string before probing: our DATABASE_URL carries Prisma-only params
  # (?connection_limit=...&pool_timeout=...) that pg_isready rejects ("invalid URI query
  # parameter"), which made the probe ALWAYS fail and silently skip migrate/build/seed
  # even with Postgres up. Prisma still gets the full URL; only the probe is trimmed.
  db_probe_url="${db_url%%\?*}"
  if [[ -n "$db_probe_url" ]] && pg_isready -d "$db_probe_url" >/dev/null 2>&1; then
    db_reachable=true
  fi
fi

if [[ "$db_reachable" == "true" ]]; then
  echo "[worktree-init] Postgres reachable — running pnpm db:migrate"
  (cd "$worktree_root" && pnpm db:migrate)
  echo "[worktree-init] Building workspace (required before seed) — ~30-60s first run"
  (cd "$worktree_root" && pnpm build)
  echo "[worktree-init] Seeding dev data — pnpm db:seed"
  (cd "$worktree_root" && pnpm db:seed)
else
  echo "[worktree-init] DB not reachable. Skipped migrate/build/seed."
  echo "[worktree-init] Run \`pnpm local:setup\` after starting Postgres."
fi

# 4. Print next steps.
cat <<EOF

[worktree-init] Done. Next steps:
  cd $worktree_root
  pnpm dev                    # starts api (:3000), chat (:3001), dashboard (:3002)
  open http://localhost:3002

  Note: first run includes \`pnpm build\` (~30-60s); re-runs are fast (turbo cache).

EOF
