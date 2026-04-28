#!/usr/bin/env bash
# =============================================================================
# Hermes Worktree Hygiene Reporter
#
# Reports — does not delete. Surfaces:
#   - worktrees whose branch is already merged into main
#   - worktrees whose branch is gone from origin
#   - worktrees with no commits in 7+ days
#   - worktrees with uncommitted changes
#
# Intended to be run as a local Hermes cron on a weekly cadence, because it
# needs access to the local working tree. Example:
#   hermes cron add --schedule "0 9 * * MON" \
#     --command "/Users/jasonli/switchboard/scripts/hermes-worktree-hygiene.sh"
#
# Output is a plain-text report on stdout. No worktree is ever removed by
# this script; the operator decides what to tear down.
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

git fetch --quiet --prune origin || true

now_epoch=$(date +%s)
stale_threshold=$((7 * 24 * 60 * 60))

merged_branches=$(git branch --merged origin/main --format='%(refname:short)' | sed 's/^[* ] *//' || true)

printf 'Switchboard worktree hygiene report — %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf '%s\n\n' '============================================================'

merged_list=()
gone_list=()
stale_list=()
dirty_list=()

while IFS= read -r line; do
  case "$line" in
    worktree\ *)
      wt_path="${line#worktree }"
      wt_branch=""
      ;;
    branch\ *)
      wt_branch="${line#branch refs/heads/}"
      ;;
    "")
      [[ -z "${wt_path:-}" ]] && continue
      # Skip the primary worktree and any worktree checked out on main itself —
      # main is reported by the CI smoke check, not by hygiene.
      if [[ "$wt_path" == "$REPO_ROOT" || "$wt_branch" == "main" ]]; then
        wt_path=""; wt_branch=""; continue
      fi

      # Merged?
      if [[ -n "$wt_branch" ]] && grep -Fxq "$wt_branch" <<<"$merged_branches"; then
        merged_list+=("$wt_path  [$wt_branch]")
      fi

      # Branch gone from origin?
      if [[ -n "$wt_branch" ]] && ! git ls-remote --exit-code --heads origin "$wt_branch" >/dev/null 2>&1; then
        gone_list+=("$wt_path  [$wt_branch]")
      fi

      # Stale (no commits in 7+ days)?
      if [[ -n "$wt_branch" ]]; then
        last_commit=$(git -C "$wt_path" log -1 --format=%ct 2>/dev/null || echo 0)
        if [[ "$last_commit" -gt 0 ]]; then
          age=$((now_epoch - last_commit))
          if [[ "$age" -gt "$stale_threshold" ]]; then
            days=$((age / 86400))
            stale_list+=("$wt_path  [$wt_branch]  (${days}d)")
          fi
        fi
      fi

      # Uncommitted changes?
      if [[ -d "$wt_path" ]]; then
        dirty=$(git -C "$wt_path" status --porcelain 2>/dev/null | head -1 || true)
        if [[ -n "$dirty" ]]; then
          dirty_list+=("$wt_path  [$wt_branch]")
        fi
      fi

      wt_path=""; wt_branch=""
      ;;
  esac
done < <(git worktree list --porcelain; printf '\n')

print_section() {
  # Usage: print_section "title" "${arr[@]+"${arr[@]}"}"
  # Caller is responsible for safe expansion of an empty array.
  local title="$1"; shift
  printf '%s\n' "$title"
  if [[ "$#" -eq 0 ]]; then
    printf '  - none\n\n'
    return
  fi
  for item in "$@"; do
    printf '  - %s\n' "$item"
  done
  printf '\n'
}

print_section "Worktrees on branches merged into origin/main:" ${merged_list[@]+"${merged_list[@]}"}
print_section "Worktrees whose branch is gone from origin:"    ${gone_list[@]+"${gone_list[@]}"}
print_section "Worktrees with no commits in 7+ days:"          ${stale_list[@]+"${stale_list[@]}"}
print_section "Worktrees with uncommitted changes:"            ${dirty_list[@]+"${dirty_list[@]}"}

printf 'Report only. No worktrees removed.\n'
printf 'To tear one down: git worktree remove <path> && git worktree prune\n'
