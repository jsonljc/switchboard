#!/usr/bin/env bash
# =============================================================================
# Hermes Pre-Push Reviewer (manual)
#
# Pipes the current branch's diff against origin/main to Hermes for an
# invariant-focused code review. Manual invocation only — there is no
# pre-push git hook wired up. Run this when you want a second opinion
# before pushing.
#
# Usage:
#   ./scripts/hermes-review.sh                 # diff vs origin/main
#   ./scripts/hermes-review.sh <base-ref>      # diff vs custom base
#
# Requires:
#   - hermes on PATH (https://github.com/.../hermes)
#   - working tree at the repo root or a subdirectory
#
# Exit codes:
#   0   review completed (verdict is in the output, not the exit code)
#   1   no diff against base, or hermes not installed
#
# Future option (NOT enabled):
#   A pre-push hook could invoke this script and block on FAIL verdicts.
#   If/when that is wired up, the bypass will be `SKIP_HERMES=1 git push`.
#   Do not enable until the reviewer's signal is calibrated.
# =============================================================================

set -uo pipefail

BASE_REF="${1:-origin/main}"

if ! command -v hermes >/dev/null 2>&1; then
  echo "ERROR: hermes CLI not found on PATH." >&2
  echo "       Install Hermes Agent before running this script." >&2
  exit 1
fi

DIFF="$(git diff "${BASE_REF}"...)"
if [[ -z "$DIFF" ]]; then
  echo "No diff against ${BASE_REF}. Nothing to review."
  exit 1
fi

read -r -d '' PROMPT <<'EOF' || true
You are reviewing a Switchboard pull request diff.

Do not praise.
Do not summarize the feature.
Only find invariant violations and launch blockers.

Check, in order:
1. Mutating actions must enter through PlatformIngress.submit().
2. WorkTrace is the canonical persistence — no trace-bypass paths.
3. Approval is lifecycle state owned by PlatformLifecycle, not a route side effect.
4. No duplicate dispatch paths or synthetic envelope bridges.
5. No fake success states or silent production fallbacks.
6. No hidden founder-only / env-gated setup behind normal UI.
7. No test-only assumptions leaking into runtime code.
8. No new approval/execution path outside PlatformLifecycle.
9. No stale approval/executable semantics reintroduced.
10. Tools remain audited and idempotent; human escalation stays first-class.

Output format (exactly this, no preamble):

Verdict: PASS | FAIL

P0 (blockers):
- <file:line> — <issue> — <minimal fix>

P1 (must-fix before merge):
- <file:line> — <issue> — <minimal fix>

P2 (worth addressing):
- <file:line> — <issue> — <minimal fix>

If a section is empty, write "- none".
EOF

FULL_PROMPT="$(printf '%s\n\n--- DIFF ---\n%s\n' "$PROMPT" "$DIFF")"
hermes chat -q "$FULL_PROMPT"
