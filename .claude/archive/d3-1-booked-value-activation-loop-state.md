# d3-1 booked-value activation loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_riley_capability_audit_2026_06_10.

Goal: make Alex emit a `service` string the booked-value resolver matches, so booked value
populates from a realistic booking flow (abstain stays the safe default; never fabricate a price).
Authority: autonomous; squash-merge ONLY if ALL gates green AND fresh-context independent review
returns zero findings >= warn AND no merge-stop glob touched. SURFACE on any genuine stop.
Task-size: standard (one bounded PR).
Base: origin/main @ 5c77f12ee (re-fetched; advanced past 00b890ff4 via #1119, none of my files touched)
baseline_sha: 5c77f12eec813496c86f56bed1346c7c2c1323e7 worktree: .claude/worktrees/d3-1-booked-value branch: feat/alex-bookable-services-catalog
merge_safety: stop-glob touched=NO (no prisma/auth/billing/consent/credential/governance/send/allowlist
file in diff — recheck at CONVERGE). Revenue-proof-adjacent (trueROAS/receipt rollup consume the value)
=> keep conservative posture; independent_review=(pending)

## Ground-truth brief (ORIENT, tool-backed)

- Resolver `resolveBookedValueCents` (packages/core/src/skill-runtime/tools/booking-value.ts:37) exact-matches
  `input.service` to a playbook service by `id` OR ci/trimmed `name`; abstains null otherwise. UNCHANGED by this slice.
- Consumer wired & tested: calendar-book booking.create (calendar-book.ts:314) calls resolveBookedValueForBooking
  with `getServicesForOrg` = PrismaPlaybookReader.readForOrganization(orgId).services (skill-mode.ts:420). Value
  stamps Opportunity.estimatedValue (cb.ts:493), booked-conversion value, ReceiptedBooking. Seam tested cb.test.ts:619-734.
- GAP: Alex's prompt service catalog comes ONLY from BUSINESS_FACTS = marketplace `ServiceSchema` (NO id, string price;
  marketplace.ts:269) via renderBusinessFacts (context-resolver.ts:16) in alexBuilder (alex.ts:104). The PRICED playbook
  catalog (onboardingPlaybook.services[], PlaybookService w/ id+numeric price) is injected NOWHERE in Alex's prompt
  (PLAYBOOK_CONTEXT = objection-handling KnowledgeEntry rows, NOT services). Two unsynced stores. Alex emits free text
  "the service they discussed" (SKILL.md:212,228) -> no exact match -> abstain -> booked value inert.
- FIX (approach a, smallest blast radius, never-fabricate-safe): builder-owned inject the PLAYBOOK service NAMES into
  Alex's prompt as a new token (BOOKABLE_SERVICES) read via the existing core PlaybookReader port (qualification/types.ts:3),
  wired in skill-mode stores; instruct Alex to set the booking-tool `service` to the EXACT matching name (NAMES not ids:
  `service` is customer-facing — confirmation text/calendar event). Resolver unchanged => abstain still default. Rejected:
  (b) id-picker (pollutes customer-facing service field, bigger blast); (c) store reconciliation (carries "which store is
  canonical" product decision -> would SURFACE).

## Concurrent-session safety (re-checked at ORIENT)

- alex-booking-fix (branch fix/alex-booking-autoexecute): STALE — last commit 2026-06-10 (6d), NO open PR. Touches
  SKILL.md booking _confirmation-response_ (step 5 pending_approval, lines ~236-238) + calendar-book governanceOverride —
  NOT the service-EMISSION lines (212/228) nor booking-value. origin/main already diverged from its SKILL.md text =>
  no live collision with my emission-line edits. Proceed; re-check at CONVERGE.
- alex-capability-audit: docs-only (README.md). No collision.

Plan: .claude/d3-1-booked-value-plan.md (8 tasks). 2B fan-out plan-grade DONE (3 reviewers, opus): core Tasks 1-6 VALIDATED correct; blocks were all in eval section (corrections below).

| step                                                 | done-condition (test/cmd)                               | status | evidence |
| ---------------------------------------------------- | ------------------------------------------------------- | ------ | -------- |
| T1 renderBookableServices + alignment seam           | core test context-resolver                              | todo   |          |
| T2 SkillStores.playbookReader port                   | core typecheck                                          | todo   |          |
| T3 alexBuilder BOOKABLE_SERVICES (fail-open)         | core test alex.test                                     | todo   |          |
| T4 SKILL.md {{BOOKABLE_SERVICES}} + emission instr   | loader body includes token                              | todo   |          |
| T5 skill-mode wire playbookReader                    | api typecheck + test                                    | todo   |          |
| T6 calendar-book seam (rendered name->stamped value) | core test calendar-book                                 | todo   |          |
| T7 eval harness stub playbook + deterministic test   | eval vitest bookable-services + router-tier + live-path | todo   |          |
| T8 eval canonical-name booking fixture (soft)        | eval schema/load-fixtures/matrix structural             | todo   |          |

gate_results (post-rebase onto origin/main@110d72469): typecheck=PASS(21/21) test=PASS(core 4234; api 2142; ONLY fail=apps/chat gateway-bridge-attribution = KNOWN load-flake, passes 4/4 isolated in 844ms, my diff does not touch apps/chat) lint=PASS format=PASS arch=PASS verify-fast=PASS(6/6) build=PASS(10/10) eval=PASS(269; live skipped no key) review=APPROVE x2 (fresh-context, zero>=warn; 2B plan-grade core validated). T1-T8 all DONE. Auto-merge bar MET: gates green + review zero>=warn + no merge-stop glob + high confidence (id-vs-name edge proven unreachable: ids are synthetic scan-N/uuid).
carry_forward (<=150 words):
2B CORRECTIONS to apply during EXECUTE (verified vs real files):

- BLOCK: eval test cmd is NOT `--filter ... test` (eval pkg has only `typecheck` script). USE `pnpm exec vitest run --config evals/vitest.config.ts <filter>` (CI uses this).
- BLOCK: `loadSkill(slug, skillsDir)` needs 2 args; import from `@switchboard/core/skill-runtime`; use `loadSkill("alex", defaultSkillsDir())` (defaultSkillsDir from run-conversation.ts:100; pattern in router-tier.test.ts:77).
- BLOCK: editing SKILL.md does NOT change skillContentHash (hashes only references/medspa/\*.md) — drop that note; no CI-gated hash test exists.
- HARDEN(warn): add alignment-seam case for two same-name/different-price services -> renderer first-wins == resolver first-wins (assert stamped == FIRST). Keep renderer dedup first-wins (do NOT prefer-priced; that would MISALIGN vs resolver).
- ACCEPT(warn): cross-store drift (booking.service becomes playbook name) — document in renderer doc-comment + surface; reconciliation is rejected approach-c (product decision).
- NIT: loader field is `body` not systemPromptTemplate; SKILL.md emit lines are 219 (slots.query) + 230 (booking.create); add eval `playbook` field INSIDE .object() before the .refine() chain (schema.ts:33-60).
- Task7 must keep router-tier + live-path-faithfulness eval tests green (they drive resolveParameters; pass iff playbook defaults "absent").

## Log

- 2026-06-16: ORIENT done. Ground truth confirmed against origin/main @ 00b890ff4. Gap = two unsynced service
  stores; Alex shown marketplace catalog, resolver keys on playbook catalog. Approach (a) chosen. Next: FRAME (brainstorm).
- 2026-06-16: FRAME+PLAN+2B done (3 adversarial reviewers; core validated, eval-section corrections applied).
  EXECUTE T1-T8 done via TDD (RED proofs captured per task). VERIFY: gates green (chat-attribution = known load-flake,
  isolated 4/4 pass). 2 fresh-context reviews APPROVE zero>=warn. Rebased onto origin/main@110d72469 (clean, no overlap),
  re-verified green. CONVERGE: PR #1121 opened (feat/alex-bookable-services-catalog), squash --auto --delete-branch
  enabled (main is branch-protected; --admin not used — respects required CI). WAITING on CI (background poll bj1j9egfa).
  NEXT on merge: remove worktree, update project_riley_capability_audit_2026_06_10 note, assess fast-follow (abstain-rate
  metric) as a fresh slice or judge unnecessary -> STOP+report.
- 2026-06-16: ARC COMPLETE. PR #1121 MERGED (squash 5caa87f28; test job green 10m28s, no flake). Local main
  fast-forwarded to include it; d3-1 worktree removed + pruned; local+remote branch deleted; memory note updated;
  fallback wakeup (cron 9564f8b3) cancelled. Main tree clean on main@5caa87f28. Fast-follow (booking-site abstain-rate
  metric) recommended as a SEPARATE future slice (not built — this session closes off here).
