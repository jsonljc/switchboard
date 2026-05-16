#!/usr/bin/env bash
# Archive superpowers specs and plans older than N days.
#
# Files are identified by the YYYY-MM-DD-*.md filename prefix and moved into
# the sibling archive/ directory under docs/superpowers/{specs,plans}/.
#
# Default behaviour is safe for unattended (launchd / cron) runs:
#   - Refuses to run during a merge / rebase / cherry-pick / detached HEAD.
#   - Refuses to run if anything in docs/superpowers/{specs,plans} is dirty.
#   - In default mode, ALSO refuses to move files unless it can immediately
#     commit them — so a launchd job won't silently strand 100 staged renames
#     on whatever feature branch happens to be checked out.
#   - Commit prerequisites: on `main` AND no unrelated paths are dirty.
#   - Never pushes — the user decides when to push.
#
# Use --no-commit to opt out of the commit gate (moves files but never commits,
# e.g. for a one-time sweep on a dedicated chore branch).
#
# Usage:
#   scripts/archive-superpowers-docs.sh [--dry-run] [--no-commit] [--days N]
#
# Flags:
#   --dry-run     Print what would happen; make no changes.
#   --no-commit   Move files but never commit, regardless of branch.
#   --days N      Override the age threshold (default: 2 days).
#   -h, --help    Show this help.
#
# Exit codes:
#   0   Success (including the no-op case).
#   2   Bad arguments.
#   3   Unsafe repo state (in-progress merge/rebase, detached HEAD, dirty area).

set -euo pipefail

# Ensure standard tool paths even under launchd (which starts with minimal PATH).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

log() { printf '[archive-superpowers] %s\n' "$*"; }
warn() { printf '[archive-superpowers] %s\n' "$*" >&2; }

# ---------- Argument parsing ----------

days=2
dry_run=0
no_commit=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --no-commit) no_commit=1 ;;
    --days)
      shift
      [ $# -gt 0 ] || { warn "--days requires a value"; exit 2; }
      days="$1"
      ;;
    --days=*) days="${1#--days=}" ;;
    -h|--help)
      sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      warn "Unknown argument: $1"
      exit 2
      ;;
  esac
  shift
done

case "$days" in
  ''|*[!0-9]*) warn "--days must be a non-negative integer (got: $days)"; exit 2 ;;
esac

# ---------- Repo guard ----------

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  warn "Not inside a git repository. Aborting."
  exit 3
fi
cd "$repo_root"

git_dir="$(git rev-parse --git-dir)"
for marker in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD rebase-merge rebase-apply; do
  if [ -e "$git_dir/$marker" ]; then
    warn "Repo in mid-operation ($marker present). Skipping."
    exit 3
  fi
done

current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [ -z "$current_branch" ]; then
  warn "Detached HEAD. Skipping."
  exit 3
fi

# Refuse to run if our work area already has uncommitted changes — we won't
# silently mix our archive moves with the user's in-flight edits.
existing_area_dirty="$(git status --porcelain -- docs/superpowers/specs docs/superpowers/plans 2>/dev/null || true)"
if [ -n "$existing_area_dirty" ]; then
  warn "docs/superpowers/{specs,plans} has uncommitted changes — skipping to avoid clobbering work:"
  printf '%s\n' "$existing_area_dirty" >&2
  exit 3
fi

# ---------- Commit eligibility (computed BEFORE moves) ----------

can_commit=0
commit_reason=""
if [ "$no_commit" -eq 1 ]; then
  commit_reason="--no-commit set"
elif [ "$current_branch" != "main" ]; then
  commit_reason="branch=$current_branch (not main)"
else
  # Pathspec exclusion handles rename porcelain (R old -> new) natively, where
  # a regex on status output had to special-case it. ':!path' is git's exclude
  # magic; both src and dst of a rename are filtered by it.
  unrelated_dirty="$(git status --porcelain -- ':!docs/superpowers/specs' ':!docs/superpowers/plans' 2>/dev/null || true)"
  if [ -n "$unrelated_dirty" ]; then
    commit_reason="unrelated dirty paths present"
  else
    can_commit=1
  fi
fi

# If we can't commit and the caller hasn't explicitly asked for --no-commit
# (i.e. consciously opted to leave files staged), refuse to move anything.
# This prevents a daily launchd run from stranding renames on a feature branch.
if [ "$can_commit" -eq 0 ] && [ "$no_commit" -eq 0 ] && [ "$dry_run" -eq 0 ]; then
  warn "Cannot commit ($commit_reason). Use --no-commit to move files anyway, or run from a clean main checkout."
  exit 0
fi

# ---------- Cutoff date ----------

# "More than N days ago" means strictly older than N days. A file with the
# same date as (today - N) is exactly N days old, which is NOT "more than N".
# We archive files with date <= (today - (N+1)).
offset=$((days + 1))
if cutoff="$(date -v-"${offset}"d +%Y-%m-%d 2>/dev/null)"; then
  : # BSD date (macOS)
elif cutoff="$(date -d "${offset} days ago" +%Y-%m-%d 2>/dev/null)"; then
  : # GNU date (Linux)
else
  warn "Cannot compute cutoff date with available 'date' binary."
  exit 3
fi

log "branch=$current_branch  cutoff=$cutoff  commit=$([ $can_commit -eq 1 ] && echo yes || echo "no ($commit_reason)")"

# ---------- Find and move ----------

declare -a moved=()

find_candidates() {
  # Top-level only (depth 1). Never recurses into archive/.
  find docs/superpowers/specs docs/superpowers/plans \
    -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md' \
    2>/dev/null | sort
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  base="$(basename "$f")"
  date_prefix="${base:0:10}"

  case "$date_prefix" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) continue ;;
  esac

  # String comparison is correct for ISO-8601 dates.
  if [ "$date_prefix" \> "$cutoff" ]; then
    continue
  fi

  dir="$(dirname "$f")"
  archive_dir="$dir/archive"
  dest="$archive_dir/$base"

  if [ -e "$dest" ]; then
    warn "skip $f (destination exists: $dest)"
    continue
  fi

  if [ "$dry_run" -eq 1 ]; then
    log "(dry-run) would move $f -> $dest"
    moved+=("$f")
    continue
  fi

  mkdir -p "$archive_dir"

  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git mv "$f" "$dest"
  else
    mv "$f" "$dest"
    git add "$dest"
  fi

  log "moved $f -> $dest"
  moved+=("$f")
done < <(find_candidates)

if [ "${#moved[@]}" -eq 0 ]; then
  log "nothing to archive."
  exit 0
fi

if [ "$dry_run" -eq 1 ]; then
  log "dry-run complete. ${#moved[@]} file(s) would be archived."
  exit 0
fi

if [ "$can_commit" -eq 0 ]; then
  log "archived ${#moved[@]} file(s). Leaving changes staged ($commit_reason)."
  exit 0
fi

count="${#moved[@]}"
git commit -m "chore(docs): auto-archive superpowers specs/plans older than ${days} days

Moved ${count} file(s) into docs/superpowers/{specs,plans}/archive/.
Cutoff date: ${cutoff}."

log "committed archive of ${count} file(s) on main."
