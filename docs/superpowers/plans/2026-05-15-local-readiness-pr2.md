# Local Readiness PR-2 — CI Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire PR-1's local-readiness invariants into the canonical CI workflow so regressions are blocked at PR time, and convert the temporary `local-readiness-followup` route-ingress allowlist entries into permanent or temporary-with-followup classifications before the gate enters CI.

**Architecture:** Three minimal additions to `.github/workflows/ci.yml`:

1. `lint` job gains `pnpm local:verify:fast` (no Postgres; skips seed-counts gracefully).
2. `test` job gains `pnpm --filter @switchboard/dashboard build` (closes the Next-build gap).
3. `setup` job (already has Postgres + `migrate deploy`) gains `pnpm db:seed` + `pnpm exec tsx scripts/check-seed-counts.ts` for seed integrity.

A prerequisite first task audits the 7 `local-readiness-followup` allowlist entries and rewrites each as one of: permanently justified, temporarily justified (with `route-governance-cleanup` follow-up tag), or must-remediate.

**Tech Stack:** GitHub Actions, pnpm/turbo, tsx for TS-script execution, Postgres service container (already wired into setup), existing PR-1 scripts (`local-verify-fast.ts`, `check-seed-counts.ts`, `check-routes.ts`).

**Budget:** CI runtime addition ≤3 minutes (spec §2.3).

**Branch slug:** `chore/ci-local-readiness-gates`.

**References:**

- Spec: `docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md` §2
- PR-1 (#549, commit `56980651`): introduces `local:verify:fast`, `local:verify`, the 7-entry temporary allowlist
- PR-1 recon notes: `docs/superpowers/plans/2026-05-15-local-readiness-notes.md`

---

## File Touch List

- Modify: `.agent/tools/route-allowlist.yaml` — rewrite the 7 `local-readiness-followup` entries with classified justifications.
- Modify: `.github/workflows/ci.yml` — add three steps across `setup` / `lint` / `test` jobs; extend the build-artifact cache to include `.agent/tools/node_modules` so `check-routes` doesn't pay install cost in every job.

No new files. No script changes (PR-1 scripts are contracts — see "What NOT to do" in handoff prompt).

---

## Task 1: Audit + reclassify the 7 route-ingress allowlist entries

**Purpose:** Before `route-ingress` enters CI via `local:verify:fast`, every allowlisted route must carry an honest, specific justification — not a `local-readiness-followup` placeholder. Per the agreed governance pattern: classify each as **permanent**, **temporary with `route-governance-cleanup` follow-up**, or **must-remediate**.

**Files:**

- Modify: `.agent/tools/route-allowlist.yaml` (replace the 7 entries appended in PR-1, lines ~149–177)

### Classification reference (apply per route)

For each of the 7 routes, read the route file end-to-end and pick exactly one classification:

| Class                     | When                                                                                                                                                                                                                         | Wording template                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Permanently justified** | Webhook receiver, signed-request callback, control-plane CRUD outside the PlatformIngress action lifecycle, admin-only non-revenue-affecting state writes, diagnostic/test-mode surfaces explicitly excluded from governance | "Permanently justified: <one-line reason>."                                      |
| **Temporarily justified** | Genuinely governed mutator (operator action with revenue impact) that should route through `PlatformIngress.submit` but remediation is larger than CI-gate scope                                                             | "Temporarily justified: <one-line reason>. Follow-up: route-governance-cleanup." |
| **Must remediate**        | Newly introduced, trivially fixable, or clearly unsafe                                                                                                                                                                       | (Stop and surface to user — out of scope for PR-2 per ship-path decision.)       |

The 7 routes to audit (preliminary first-read characterizations — sharpen by reading the file):

1. `apps/api/src/routes/whatsapp-send-test.ts` — diagnostic WhatsApp Tech Provider verification surface.
2. `apps/api/src/routes/recommendations.ts` — `POST /:id/act` calls `actOnRecommendation` (governed mutator).
3. `apps/api/src/routes/meta-deletion.ts` — Meta GDPR `signed_request` deletion webhook (HMAC-verified, no operator).
4. `apps/api/src/routes/lifecycle-disqualifications.ts` — operator-facing Phase 3b confirm/dismiss; calls `disqualificationHook.confirm/dismiss`.
5. `apps/api/src/routes/dashboard-reports.ts` — mostly reads; one mutating endpoint (~line 168).
6. `apps/api/src/routes/dashboard-opportunities.ts` — `PATCH .../stage` calls `transitionOpportunityStage` (governed mutator).
7. `apps/api/src/routes/admin-consent.ts` — PDPA consent grant/revoke/clear writes.

- [ ] **Step 1: Read each route file** (~5 routes per pass; mark working notes on classification)

For each route in the list, read the file from top to bottom — confirm whether mutations touch the agent action lifecycle (`PlatformIngress.submit`) domain or sit outside it (webhooks, admin compliance ledgers, diagnostic tools). Make a single classification decision per route and capture the one-line justification.

If any route surprises you with a "must remediate" classification (e.g. trivially fixable bypass that takes one wrapper call), STOP and surface to the user. Per the agreed decision, route remediation is explicitly out of PR-2 scope.

- [ ] **Step 2: Rewrite the `local-readiness-followup` block in `.agent/tools/route-allowlist.yaml`**

Replace the whole block introduced by PR-1 (the section beginning `# local-readiness-followup — TEMPORARY allowlist`) with classified entries. Group entries under two headings:

```yaml
# ---------------------------------------------------------------------------
# Permanently justified — routes outside the PlatformIngress action lifecycle
# ---------------------------------------------------------------------------
- path: "apps/api/src/routes/<file>.ts"
  reason: "Permanently justified: <one-line specific reason>."

# ---------------------------------------------------------------------------
# Temporarily justified — governed mutators pending route-governance-cleanup
# ---------------------------------------------------------------------------
# Tracked separately as route-governance-cleanup. Each entry below is a
# genuine mutator that should eventually route through PlatformIngress.submit;
# remediation is intentionally out of PR-2 scope (CI enforcement first).
- path: "apps/api/src/routes/<file>.ts"
  reason: "Temporarily justified: <one-line specific reason>. Follow-up: route-governance-cleanup."
```

Do NOT carry forward the words "pre-existing on main" or "needs audit" — the audit is being completed in this step. Replace with specific reasons (e.g. "Meta GDPR data-deletion callback — HMAC-verified webhook with no operator principal").

- [ ] **Step 3: Verify `local:verify:fast` is still green**

Run: `pnpm local:verify:fast`

Expected: `✓ local:verify:fast — all checks passed`. If route-ingress fails, the YAML rewrite dropped a path; reconcile against the list in Step 1.

(DB may not be reachable in the worktree — seed-counts will skip with a warning, which is the documented behavior. That's fine.)

- [ ] **Step 4: Commit**

```bash
git add .agent/tools/route-allowlist.yaml
git commit -m "$(cat <<'EOF'
chore(route-allowlist): classify the 7 local-readiness-followup entries

Replace the temporary local-readiness-followup block with
classified entries (permanent vs. temporary-with-followup) before
PR-2 promotes route-ingress into CI via pnpm local:verify:fast.

No route refactor — classification only, per the agreed PR-2 scope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cache `.agent/tools/node_modules` in the build artifact cache

**Purpose:** `bash .agent/tools/check-routes` will run from the `lint` job via `local:verify:fast`. The script bootstraps its own `node_modules` via `pnpm install --ignore-workspace` if missing — adds ~20-30s on every cache-miss. Adding the directory to the existing artifact cache amortizes the cost across jobs.

**Files:**

- Modify: `.github/workflows/ci.yml` — extend the `path:` lists in the `actions/cache/save` step (setup job) and every `actions/cache/restore` step (typecheck/lint/test/security/architecture).

- [ ] **Step 1: Bootstrap `.agent/tools/node_modules` in the setup job**

Add a new step in the `setup` job immediately AFTER `- name: Install dependencies` and BEFORE `- name: Generate Prisma client`:

```yaml
- name: Install .agent/tools dependencies
  run: cd .agent/tools && pnpm install --ignore-workspace --no-frozen-lockfile
```

This ensures the cache save (later in the same job) picks up a populated `.agent/tools/node_modules`.

- [ ] **Step 2: Add `.agent/tools/node_modules` to the cache path list**

In the setup job's `actions/cache/save@v5` step, append `.agent/tools/node_modules` to the `path:` list (one line per glob). The full updated `path:` list:

```yaml
path: |
  node_modules
  pnpm-lock.yaml
  packages/*/dist
  packages/*/node_modules
  cartridges/*/dist
  cartridges/*/node_modules
  apps/*/dist
  apps/*/.next
  apps/*/node_modules
  packages/db/node_modules/.prisma
  .agent/tools/node_modules
```

- [ ] **Step 3: Mirror the addition into every `actions/cache/restore@v5` step**

There are five `restore` calls in `ci.yml` (typecheck, lint, test, security, architecture jobs). Each lists the same `path:`. Append `.agent/tools/node_modules` to each one identically.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: cache .agent/tools/node_modules across jobs

The check-routes script bootstraps an isolated node_modules via
pnpm install --ignore-workspace if missing. Pre-installing in the
setup job and including in the artifact cache avoids paying the
install cost in every dependent job (lint job runs check-routes
via local:verify:fast in the next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `pnpm local:verify:fast` into the lint job

**Purpose:** Promote the structural checks (env-completeness, live-flag manifest, arch:check, route-ingress, seed-counts-or-skip) into CI. No Postgres required — the script skips seed-counts with a warning when `DATABASE_URL` is unset.

**Files:**

- Modify: `.github/workflows/ci.yml` — add one step at the end of the `lint` job.

- [ ] **Step 1: Add the step**

Append AFTER `- name: Check formatting` in the `lint` job:

```yaml
- name: Local readiness pre-flight (fast)
  run: pnpm local:verify:fast
```

Notes for placement:

- The `lint` job has no `env:` block; `local:verify:fast` does not need `DATABASE_URL` (seed-counts skip path is the documented behavior).
- The `.agent/tools/node_modules` cache from Task 2 means `check-routes` runs without re-installing.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci(lint): add pnpm local:verify:fast structural pre-flight

Enforces PR-1 invariants: env-completeness, live-flag manifest,
arch:check, route-ingress, seed-counts (skipped — no DB attached).
Closes the "no automated check binds these properties together" gap
called out in the local-readiness spec.

Refs spec §2.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add dashboard `next build` to the test job

**Purpose:** Close the documented `feedback_dashboard_build_not_in_ci.md` gap — `.js`-extension regressions Next.js rejects currently slip past `pnpm lint` + `pnpm typecheck` + `pnpm test`. Spec §2.2 lists this as part of PR-2.

**Files:**

- Modify: `.github/workflows/ci.yml` — add one step at the end of the `test` job (after the "Check for untested packages" step).

- [ ] **Step 1: Add the dashboard build step**

Append AFTER `- name: Check for untested packages` in the `test` job:

```yaml
- name: Dashboard production build
  env:
    CREDENTIALS_ENCRYPTION_KEY: ${{ secrets.CI_CREDENTIALS_ENCRYPTION_KEY || 'ci-test-encryption-secret-32chr' }}
    NEXTAUTH_SECRET: ${{ secrets.CI_NEXTAUTH_SECRET || 'ci-test-nextauth-secret' }}
  run: pnpm --filter @switchboard/dashboard build
```

Notes:

- The test job currently has no top-level `env:` block. The dashboard build reads `CREDENTIALS_ENCRYPTION_KEY` and `NEXTAUTH_SECRET` at module-init for some server-side code paths; we mirror the env values from the `setup` job to avoid surprises during build prerendering.
- Live-mode flags (`NEXT_PUBLIC_*_LIVE`) are baked from `.env.example` defaults the spec covers — no override needed.
- The cached `apps/*/dist` and `apps/*/.next` artifacts speed this up significantly since the setup job already runs `pnpm build`.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci(test): add dashboard next build to close the build-not-in-CI gap

Lint + typecheck + vitest don't exercise Next.js's bundler — .js
extension regressions on relative or @/ aliased imports currently
slip past CI. This closes that gap per spec §2.2 and the long-running
feedback_dashboard_build_not_in_ci.md memory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add seed integrity check to the setup job

**Purpose:** Re-run `pnpm db:seed` after `migrate deploy` against a clean schema, then assert seed-row minimums. Catches regressions in `seed-dev-data.ts` and detects accidental dependence on previous-run state.

**Files:**

- Modify: `.github/workflows/ci.yml` — add two steps to the `setup` job, AFTER `Run database migrations` and BEFORE `Build`.

- [ ] **Step 1: Add seed + seed-count steps**

Insert AFTER `- name: Run database migrations` and BEFORE `- name: Build` in the `setup` job:

```yaml
- name: Seed development data
  run: pnpm --filter @switchboard/db exec tsx prisma/seed.ts

- name: Verify seed counts
  run: pnpm exec tsx scripts/check-seed-counts.ts
```

Notes:

- `seed.ts` calls into `seed-dev-data.ts` when `NODE_ENV !== "production"`. The setup job has no `NODE_ENV` set → defaults to dev path → dev data seeded.
- The setup job's `env:` block already provides `DATABASE_URL` and `CREDENTIALS_ENCRYPTION_KEY` — both required by the seed.
- We invoke `tsx prisma/seed.ts` directly (not `pnpm db:seed`) because the root `db:seed` script may include extra orchestration; this matches what `prisma migrate deploy` would call. If `package.json` exposes `pnpm db:seed` (it does), prefer that — replace the `Seed development data` run with `run: pnpm db:seed`. **Use whichever invocation matches `packages/db/package.json` and root `package.json` — verify in worktree before running.**

- [ ] **Step 2: Verify invocation matches reality**

Run from the worktree:

```bash
grep -E '"(db:seed|seed)"' package.json packages/db/package.json
```

Expected: confirms the canonical seed entrypoint. Adjust the workflow step's `run:` to match.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci(setup): seed dev data + verify seed counts after migrate

Asserts that pnpm db:seed produces the row minimums enforced
by scripts/check-seed-counts.ts (org/agents/contacts/opportunities/
auditEntries/approvalRecords/scheduledTriggers). Catches regressions
in seed-dev-data.ts at PR time.

Refs spec §2.2 (DB job — co-located in setup since setup already
has the Postgres service + migrate deploy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Push, observe CI, iterate

**Purpose:** Confirm green CI + ≤3-min total runtime addition. The only meaningful "test" of workflow changes is running them.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin chore/ci-local-readiness-gates
```

- [ ] **Step 2: Open a draft PR**

```bash
gh pr create --draft --title "chore: CI gates for local readiness (PR 2 of local-readiness spec)" --body "$(cat <<'EOF'
PR 2 of `docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md` (#533).
Builds on PR-1 (#549). Plan: `docs/superpowers/plans/2026-05-15-local-readiness-pr2.md`.

## Highlights

- **lint job:** `pnpm local:verify:fast` — env-completeness, live-flag manifest, arch:check, route-ingress, seed-counts (skipped, no DB).
- **test job:** `pnpm --filter @switchboard/dashboard build` — closes the documented build-not-in-CI gap.
- **setup job:** `pnpm db:seed` + `pnpm exec tsx scripts/check-seed-counts.ts` — seed integrity after `migrate deploy`.
- **Allowlist audit:** PR-1's 7 `local-readiness-followup` entries reclassified as permanent or temporary-with-`route-governance-cleanup`-followup. No route refactoring in PR-2 (out of scope).

## CI runtime impact

Target: ≤3 minutes added across all jobs (spec §2.3). Actual numbers logged after the first green run.

## Existing CI job structure (before this PR)

- `setup` — Postgres service + install + Prisma generate + drift check + migrate + build + cache.
- `typecheck`, `lint`, `test`, `architecture`, `security` — restore cache, run their step.
- `secrets`, `docker` — independent.

This PR extends `setup` / `lint` / `test` only.

## Route-ingress decision

Per the agreed PR-2 scope: audit + classify the 7, do NOT remediate routes in this PR. Each entry now reads either as permanently justified or temporarily justified with a `route-governance-cleanup` follow-up tag. See `.agent/tools/route-allowlist.yaml` for the new wording.

Refs: #533, #549.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch the CI run; capture runtimes**

```bash
gh pr checks --watch
```

Expected: all jobs green. Capture per-job runtime delta:

| Job   | Pre-PR baseline (last green main) | This PR | Δ   |
| ----- | --------------------------------- | ------- | --- |
| setup | ~?                                | ~?      | ~?  |
| lint  | ~?                                | ~?      | ~?  |
| test  | ~?                                | ~?      | ~?  |

Total Δ must be ≤3 min per spec §2.3. If exceeded:

- Most likely culprit: dashboard build in test job (can take 60–90s).
- Mitigation 1: move dashboard build to its own parallel job (depends on `setup`, no other dependents). Restores test job to baseline runtime; dashboard build runs in parallel.
- Mitigation 2: re-check whether `apps/*/.next` cache from setup is being restored correctly — incremental builds are far faster than cold.

- [ ] **Step 4: Mark PR ready for review**

```bash
gh pr ready
```

- [ ] **Step 5: Do NOT push more commits after enabling auto-merge**

Per `feedback_auto_merge_captures_head_early.md` — if you enable auto-merge, `gh pr merge --auto --squash` squashes the HEAD GitHub evaluated, not at fire time. Any late commit after auto-merge is enabled orphans. If you need a late fix, disable auto-merge first OR cherry-pick to a follow-up PR.

---

## Verification matrix (per `superpowers:verification-before-completion`)

Before claiming this PR complete, run each:

| Claim                           | Verification                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Allowlist is honest             | `grep -c "local-readiness-followup" .agent/tools/route-allowlist.yaml` → `0` |
| `local:verify:fast` still green | `pnpm local:verify:fast` → exit 0                                            |
| Workflow YAML parses            | `gh workflow view ci.yml` → no errors                                        |
| CI green                        | `gh pr checks` → all checks pass                                             |
| Runtime ≤3min added             | Computed from `gh run view <id> --json jobs`                                 |

---

## Out of scope (explicit)

- Route remediation for the 7 (or any subset). User decision: PR-2 is CI enforcement only.
- Modifying `local:verify:fast` or `local:verify` scripts — they are PR-1 contracts.
- Silently weakening the route-ingress check (e.g. removing the routes from the source list).
- Adding a separate "DB job" — the existing `setup` job already has Postgres and runs `migrate deploy`; collocating seed integrity there avoids spinning up a redundant Postgres service.
- Backporting any of these checks to feature branches. CI changes are forward-only.

## Self-review pass

Spec coverage:

- §2.1 (document existing CI job structure): captured in PR body Task 6.
- §2.2 (add gates): Tasks 3 (lint job — local:verify:fast), 4 (test job — dashboard build), 5 (setup job — seed integrity). The spec calls out a "DB job" — collocated in `setup` per the existing repo pattern (single Postgres service); documented in PR body.
- §2.3 (≤3 min budget): Task 6 captures runtime and lists mitigations if exceeded.
- Route-ingress 7-entry decision (PR-1 followup obligation): Task 1.

No placeholders. No "TBD". Every step has an exact command or YAML fragment. Type consistency N/A (no TS types touched).
