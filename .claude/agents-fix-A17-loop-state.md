# A17 — weekly owner-report recipient isolation (P1-3) loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_second_wave_gap_eval_2026_06_22 + moc_launch_readiness.

Goal: stop owner-report recipients falling back to the process-global ESCALATION_EMAIL_RECIPIENTS; read ONLY a per-org stored list (no env), then fall through to the org's verified dashboard users.
Authority: autonomous-with-guardrails BUT A17 is multi-tenant recipient isolation (plan-marked SURFACE) -> STOP at SURFACE-before-merge (human merge call).
Task-size: standard (3 prod files + 2 test files, apps/api only, NO schema change).
Base: origin/main @ 3a876f4c3 (re-fetched; S8b/#1254 landed mid-setup, rebased onto it; its app.ts edits at ~L951/L1088 do NOT touch the report block L1029-1060). baseline_sha: 3a876f4c3626d98d46fbfeab4a5262da0fc22413
merge_safety: stop-glob touched=NO by name, but plan marks A17 SURFACE (multi-tenant isolation) -> surface regardless. independent_review=<pending>

## Ground truth (tool-verified on base 3a876f4c3)

- Leak: app.ts:1040 wires `getConfig: (id) => getEscalationConfig(prismaClient, id)`. `getEscalationConfig` (escalation-config-service.ts:45-55) returns env `ESCALATION_EMAIL_RECIPIENTS` for any org with no stored escalationConfig -> identical shared inbox for every config-less org. resolveOwnerReportRecipients (weekly-report-recipients.ts:28) returns config.emailRecipients before the verified-user fallback -> cross-tenant leak. Dispatch fans out per active-deployment org. Gated behind LEDGER_WEEKLY_REPORT_ENABLED (default off).
- `getEscalationConfig` has EXACTLY ONE prod consumer = the report path (app.ts:1032/1040). No breach-email consumer exists yet -> leave it exported+tested (NOT dead; audit scopes breach env fallback as a separate follow-up). Do not delete.
- `resolveOwnerReportRecipients` consumers = app.ts + its test only. Rename blast radius = 2 files (both mine).
- `escalationConfig` = `Json?` on OrganizationConfig (schema.prisma:452). NO migration.
- delivery consumer: weekly-report-delivery.ts:123-127 maps recipients.length===0 -> {status:"no_recipients"} (soft non-failing).
- api Prisma-mock pattern: `{ organizationConfig: { findUnique: vi.fn().mockResolvedValue(...) } } as never` (escalation-config-service.test.ts).

## Design (determined; no brainstorm — fix against named files)

1. NEW `getStoredEscalationRecipients(prisma, orgId): Promise<string[]>` in escalation-config-service.ts — reads OrganizationConfig.escalationConfig.emailRecipients; returns [] when absent/non-array. NO env fallback. (Real producer.)
2. weekly-report-recipients.ts: rename dep `getConfig:(orgId)=>Promise<{emailRecipients}>` -> `getStoredRecipients:(orgId)=>Promise<string[]>`; body returns stored list if non-empty else verified users; update header comment (drop env-fallback claim).
3. app.ts report block: import getStoredEscalationRecipients, drop getEscalationConfig import + the {emailRecipients} wrapper; wire `getStoredRecipients:(id)=>getStoredEscalationRecipients(prismaClient,id)`. Leave listVerifiedUserEmails inline reader as-is (already org-scoped, correct).

| step | done-condition (test/cmd)                                                                                                                                                                                    | RED proof                               | status | evidence (cmd->result / file:line)                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| 1    | escalation-config-service.test.ts: getStoredEscalationRecipients leak-proof (env SET + stored null -> []; stored array -> it; non-array -> [])                                                               | TypeError: not a function (4/4 new RED) | DONE   | vitest run -> 4 fail (symbol missing), 3 orig pass                                                |
| 2    | implement getStoredEscalationRecipients -> step-1 tests green                                                                                                                                                | -                                       | DONE   | vitest run -> 7/7 pass                                                                            |
| 3    | weekly-report-recipients.test.ts: rename dep in 3 tests + ADD real-producer composition (real reader over fake Prisma null + env SET + verified users -> org-B users, env absent) + no-config-no-users -> [] | deps.getConfig not a function (5/5 RED) | DONE   | vitest run -> 5 fail at recipients.ts:27                                                          |
| 4    | rename dep + body + header in weekly-report-recipients.ts -> step-3 tests green                                                                                                                              | -                                       | DONE   | vitest run -> 5/5 pass                                                                            |
| 5    | app.ts wiring swap; api tsc clean                                                                                                                                                                            | -                                       | DONE   | swap done (no getEscalationConfig left in app.ts); pnpm build (10/10) then api tsc clean (exit 0) |

gate_results (VERIFY 2026-06-23): typecheck=PASS test_api=PASS test_all=PASS-w/-known-flake(chat-attr + db-needs-postgres, baseline-confirmed pre-existing, 0 overlap) lint=PASS format=PASS arch=PASS(app.ts has eslint-disable max-lines) verify-fast=PASS security=PASS(ignoreGhsas) build=PASS(10/10) eval=n/a · review=SHIP(independent opus, all 3 acceptance MET, nits only)
VERIFY nits applied: (1) test comment precision reworded; (2) reverted build-drift apps/dashboard/next-env.d.ts (Next-regenerated, not P1-3). Working tree = exactly 5 api files. 12/12 unit tests pass + prettier clean post-edit.
SURFACE follow-ups (out of scope, note in PR): getEscalationConfig now orphaned of live callers (breach path never was wired; env-fallback breach email = explicit separate follow-up); stale spec line docs/superpowers/specs/2026-06-16-ledger-lite-weekly-report.md:59 (correct via own docs PR).
carry_forward (<=150 words): determined small slice; SURFACE before merge (multi-tenant). getEscalationConfig stays (1 follow-up = breach-email env fallback, out of scope). No schema/migration. eval n/a (no decision-engine touch). Acceptance: env list NEVER a recipient source for owner reports (real-producer test) + org-B config-less report -> org-B verified users or no_recipients.

## Fan-out grade verdict (2 opus graders, CODE-GROUNDED + CRITIC/COMPLETENESS)

BOTH = PASS. No blocker, no double-flagged issue. Refinements folded into EXECUTE:

- [req] getStoredEscalationRecipients gets a "no env fallback — owner-report-safe, never cross-tenant" docstring (don't let a future reader add a fallback to match env-laden getEscalationConfig).
- [req] rewrite FULL header in weekly-report-recipients.ts (resolution-order block L6-9 AND wiring sentence L12-13) — drop every env/getEscalationConfig mention.
- [req] leak-proof tests: copy existing try/finally env save/restore (escalation-config-service.test.ts:30-42) + recognizable env sentinel (leaked@env.test) so "no env addr appears" is unambiguous.
- [req] do NOT touch the existing getEscalationConfig env-fallback test (documents unchanged behavior).
- [surface-only, doctrine] stale spec line docs/superpowers/specs/2026-06-16-ledger-lite-weekly-report.md:59 names env fallback as primary source -> superseded by 2026-06-22 fix-plan on main; correct via its OWN docs PR, do NOT edit on this impl branch.
- [surface-note] getEscalationConfig has ZERO prod consumers after this swap; intentionally retained (breach-email follow-up, out of scope); kept alive by its test; no dead-code gate (no noUnusedLocals/knip/ts-prune) -> build safe.
  Confirmed non-issues: type flow compiles (string[]->string[]); escalationConfig existing Json? (no migration); ESCALATION_EMAIL_RECIPIENTS already in env-allowlist:42 (REMOVING a dep, no allowlist edit); verified-users reader org-scoped (where organizationId:id, emailVerified not null); pilot non-regressed (provision-pilot.mts:106 sets emailVerified on owner -> verified-users fallback catches it); breach EmailEscalationNotifier uses approvers not env (breach correctly out of scope); getConfig rename != GovernanceProfileStore.getConfig (different symbol).

## Log

- 2026-06-23: ORIENT done. Worktree off origin/main; rebased onto 3a876f4c3 (S8b landed mid-setup, disjoint). Leak + blast radius tool-confirmed. Design determined.
- 2026-06-23: FAN-OUT grade = 2x PASS (no blocker). -> EXECUTE TDD.
- 2026-06-23: GOTCHA (self): edited test/source via MAIN-repo absolute paths (read before worktree existed) -> contaminated main working tree; worktree vitest silently ran the UNMODIFIED file (3 tests not 7) = the tell. Reverted main, re-applied at worktree-prefixed paths. LESSON: in a worktree, every Read/Edit must use the WORKTREE absolute path; a test running FEWER cases than you wrote = wrong-copy edit. Fresh worktree also had NO node_modules (init skipped on DB-unreachable) -> pnpm install; and api tsc needs lower-layer dist -> pnpm build first.
- 2026-06-23: EXECUTE done (steps 1-5 all RED->GREEN, 12/12 unit tests). VERIFY done (gates green + independent SHIP; 2 nits applied: test-comment precision + reverted next-env.d.ts build drift).
- 2026-06-23: CONVERGE = SURFACE. commit 6a0593a11 (5 api files); pushed; PR #1256 OPEN (mergeState BLOCKED = CI in progress + branch protection). STOPPED at surface per AUTHORITY (A17 multi-tenant isolation = human merge call). Fast CI checks (evals/secrets) green; heavy required checks pending; all gates verified locally green. Worktree NOT torn down (PR unmerged). NEXT (human): confirm `gh pr checks 1256` all required==pass, then merge; then A18.
- 2026-06-24: MERGED. Human gave merge go (next session). Pre-merge re-check: all 15 checks pass (typecheck/test/lint/architecture/security/docker/5x eval/CodeQL/secrets/setup); merge-base == origin/main @ 3a876f4c3 (no divergence, no rebase); three-dot diff = exactly the 5 api files. `MERGEABLE CLEAN`. Squash-merged -> merge commit e01d78383 (#1256). Local main ff'd; worktree removed + branch deleted (local + remote auto-delete). DONE. Out-of-scope follow-ups still open: getEscalationConfig now caller-less (breach-email env fallback = separate slice); stale spec line ledger-lite-weekly-report.md:59 (own docs PR).
