# A4 Contact identity matcher loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note [[project_all_agents_improvement_audit]]; plan slice A4 in
docs/superpowers/plans/2026-06-20-all-agents-fix-plan.md (D1 LOCKED).

Goal: dedup-by-reuse + flag-on-ambiguity at lead intake (D1). Authority: SURFACE-before-merge (user makes merge call).
Task-size: standard (one bounded PR; large but cohesive — splitting creates inert half-wired states).
Base: origin/main @ 464d82e4f (re-fetched 2026-06-21) baseline_sha: 464d82e4f
Worktree: .claude/worktrees/agents-fix-a4-identity branch fix/contact-identity-matcher (off fresh origin/main, env-init'd)
merge_safety: stop-glob touched=YES (prisma migration + _consent_ + receipts/issuance) -> SURFACE-before-merge mandatory
independent_review=pending

## ORIENT ground-truth brief (each claim tool/file-backed, verified 2026-06-21)

- `LeadIntakeHandler.handle` (packages/core/src/intents/lead-intake-handler.ts:47) dedups ONLY on
  idempotencyKey (`findContactByIdempotency` :48), then `upsertContact` (:66). Never calls findByPhone/email. GAP REAL.
- Store seam = NARROW `LeadIntakeStore` (interface inline lead-intake-handler.ts:3-33; impl
  `PrismaLeadIntakeStore` packages/db/src/stores/lead-intake-store.ts:51). NOT the broad ContactStore
  (which has findByPhone). upsertContact keyed on (org, idempotencyKey) unique. Wired at
  apps/api/src/bootstrap/contained-workflows.ts:225 `new LeadIntakeHandler({ store: leadIntakeStore })`.
- `LeadIntake.contact.name` EXISTS (optional, lead-intake.ts:11) but is NEVER persisted today
  (UpsertContactInput has no `name`). Corroboration-by-name needs name threaded through upsertContact.
- Consent = derived from timestamps: pdpaJurisdiction/consentGrantedAt/consentRevokedAt (deriveConsentStatus
  pdpa-consent.ts:57) + messagingOptIn/messagingOptInAt/messagingOptOutAt. ConsentStatus enum =
  not_applicable|pending|granted|revoked (pdpa-consent.ts:6). NO most-restrictive helper exists — must write.
  At intake today, only messagingOptIn is set (CTWA/instant_form->true); PDPA consent untouched.
- #1212 RECONCILIATION (CONFIRMED CLEAN): `evaluateExceptions` ALREADY accepts `duplicateContactRisk?: boolean`
  (evaluate-exceptions.ts:22, comment "True when the contact matches another by phone/email"). #1212 computes
  it at ISSUANCE via a live phoneE164 exact-match probe excluding self (issue-receipted-booking.ts:102-114),
  feeds buildReceiptedBookingData->evaluateExceptions->ReceiptedBooking.exceptions. Read path hardcodes false
  (array-sourced, by design). Operator reconcile flow (prisma-receipted-booking-store.ts:307-428) flags/resolves
  by code. NO intake-time exceptions surface exists (no booking at intake).
  => Intake producer must PERSIST a Contact-level signal that the issuance read ORs into duplicateContactRisk.
  Boolean OR => no double-count (evaluateExceptions emits <=1 entry/code; mergeExceptions de-dups by code).
- Helpers to reuse: normalizeToE164(raw, region?) (schemas/phone.ts:28), normalizeEmail=lowercase.trim
  (core/identity/normalize.ts:14). findByPhone pattern: prisma-contact-store.ts:131 (normalizes then queries phoneE164).
- Contact model schema.prisma:1784-1841: name?, phone?, phoneE164?, email?, idempotencyKey?, messagingOpt\*,
  pdpa consent fields. @@unique([org,idempotencyKey]); @@index([org,phoneE164]); @@index([org,phone]); NO email index.

## FRAME design (LOCKED 2026-06-21; D1 untouched; 4 open rules resolved)

KEY ARCH DECISION (intake producer feeding evaluateExceptions): persist Contact.duplicateContactRisk at intake;
issuance ORs it into #1212's live phone-probe before evaluateExceptions. Boolean OR => no double-flag (evaluateExceptions
emits <=1 entry/code; mergeExceptions de-dups by code). Covers the email-only gap #1212's phone-only probe misses.
Rejected: (a) rely on #1212 alone = no intake producer + misses email-only; (b) mirror exceptions-array onto Contact = YAGNI.

RESOLVED OPEN RULES:
(a) Name corroboration = BOTH sides non-empty name AND normName(a)==normName(c), normName = trim+collapse-ws+lowercase.
No fuzzy (exact-after-normalize; spec defers fuzzy to v2). Missing name on EITHER side => NOT corroborated.
(b) Decision procedure (pure fn decideContactMatch over candidates = contacts where phoneE164==normPhone OR email==normEmail): - 0 candidates -> CREATE (no flag). - exactly 1 -> REUSE iff corroborated AND no field-conflict; else CREATE+FLAG. - >1 -> CREATE+FLAG (ambiguous; never pick one).
field-conflict (both non-null, normalized-differ) on email OR phone. NULL on either side != conflict (absence != contradiction).
Reuse requires: exactly-1 AND name-corroborated AND no email/phone conflict.
(c) Consent consolidation on reuse = PRESERVE existing consent untouched (no write to existing contact's consent/optIn
fields). Rationale: intake only ever carries OPT-IN/neutral signals (never a restriction), so most-restrictive({existing,
incoming}) == existing always. Reuse = return existing id + log lead_received activity; NO identity/consent mutation,
NO backfill (v1). Test proves an opted-out/revoked existing contact is NOT re-widened by an opt-in-bearing reuse lead.
(d) Add @@index([organizationId, email]) (FULL, pure-Prisma; not partial — migration simplicity + clean db:check-drift;
partial-size optimization noted future). Same migration as the duplicateContactRisk column. Generate via migrate diff
--script (no TTY per feedback_prisma_migrate_dev_tty); match Prisma index naming (63-char cap); db:check-drift if PG up.

RESOLVED RISKS:

- Replay of a reuse-lead: caught by PlatformIngress WorkTrace idempotency on the lead's OWN key (platform-ingress.ts:104-160)
  BEFORE the handler runs => no activity double-log. No activity-level idempotency needed. (Verify in fan-out CODE-GROUNDED.)
- Flag set on the NEW contact only (the uncertain arrival). #1212's phone-probe gives symmetric coverage for phone cases;
  known bound: an email-only dup where the OLDER contact books is not surfaced (documented, not silent).
- Matcher v1 matches on normalized phoneE164 + lowercased email (indexed). Un-normalizable phone (e164 null, A3 edge) ->
  no match -> create new (pre-existing limitation; #1212 also can't flag it). Documented.

ARCH (isolation): pure decision fn in core (match-contact-identity.ts) + store I/O (findByPhoneOrEmail) + handler orchestration.

## Edit surfaces (file:line)

1. packages/db/prisma/schema.prisma:1784-1841 — add duplicateContactRisk Boolean @default(false) + @@index([org,email]) + migration.
2. packages/schemas/src/lifecycle.ts:102 ContactSchema — add duplicateContactRisk: z.boolean().default(false).
3. packages/core/src/intents/match-contact-identity.ts (NEW) — pure decideContactMatch + normName/corroborate/conflict helpers + test.
4. packages/core/src/intents/lead-intake-handler.ts — extend LeadIntakeStore iface (findByPhoneOrEmail; upsertContact +name +duplicateContactRisk);
   orchestrate normalize->findByPhoneOrEmail->decideContactMatch->{create|reuse|create_flagged}.
5. packages/db/src/stores/lead-intake-store.ts:51 — findByPhoneOrEmail impl; upsertContact persist name + duplicateContactRisk.
6. packages/db/src/stores/prisma-contact-store.ts mapRowToContact — map duplicateContactRisk.
7. packages/core/src/skill-runtime/tools/issue-receipted-booking.ts:82-114 — select duplicateContactRisk; OR persisted into probe.

| step       | done-condition (test/cmd) | RED proof | status  | evidence |
| ---------- | ------------------------- | --------- | ------- | -------- |
| (plan TBD) |                           |           | pending |          |

## FAN-OUT PLAN GRADE (2B) — 3 opus graders (CRITIC/COMPLETENESS/CODE-GROUNDED), 2026-06-21

Result: 3/3 REVISE, CONVERGENT on the mechanical interface-break fan-out (design held under all lenses).
Applied as plan revision R1 (.claude/agents-fix-A4-plan.md). Convergent fixes:

- z.boolean().default(false) => REQUIRED on Contact OUTPUT type => add duplicateContactRisk:false to ALL hand-built
  Contact literals: lifecycle-service.test.ts:35, fallback-handler.test.ts:53, apps/api test-stores.ts:186 (+grep-sweep).
- findByPhoneOrEmail required => fix typed mock makeStore() lead-intake-workflow.test.ts:23.
- mapRowToContact closed param type needs duplicateContactRisk?:boolean|null (prisma-contact-store.ts ~424-445).
- test paths: ContactSchema test -> src/**tests**/lifecycle.test.ts (exists); lead-intake-store.test.ts = CREATE.
- VERIFY must add --filter @switchboard/api test+typecheck (core-green/app-red trap). eval:governance NOT required.
- preserve existing handler tests (R1-E); issuance test via makeTx not as-never literal (R1-F).
  Graders CLEARED (no action): consent-non-widening sound; OR no double-count (mergeExceptions de-dups by code);
  replay idempotency true (PlatformIngress + findContactByIdempotency); read-path safe (monotonic flag != re-open bug,
  documented R1-H); no layering/NaN/updateMany/fail-open; migrate diff cmd+paths correct; index name 34 chars under cap.
  Decision: applied R1, PROCEED to EXECUTE (mechanical fixes; per-task tsc + --filter api gate are the backstop;
  no second grade round needed). Agents resumable: CRITIC=afde9f4af83ab8b84, COMPLETENESS=acddb6757ec8398c1, CODE-GROUNDED=a8ef97f1da35fd2d5.

## EXECUTE — DONE 2026-06-21. 5 commits on fix/contact-identity-matcher:

- 3fd9e14c6 feat(db): Contact.duplicateContactRisk column + email index (+ migration drift-clean, +5 Contact literals R1-A, mapRowToContact R1-B)
- 967e19bc0 feat(core): pure decideContactMatch (10 tests) — noUncheckedIndexedAccess guard added
- 7ee3813dd feat(db): findByPhoneOrEmail (take 2) + upsert name/flag (6 mocked tests) + R1-D/R1-E mock fixes
- 44b9f0214 feat(core): handler matcher orchestration (12 tests incl reuse/flag/consent-non-widen/email-only)
- 2e268f94a feat(core): issuance ORs persisted flag (11 tests, no #1212 regression) + R1-F harness extend
  Per-package tsc GREEN during EXECUTE: schemas/core/db/api. db:check-drift GREEN. Touched-file tests all GREEN.
  NOTE: pre-commit hook runs eslint+prettier only (NOT tsc) -> ran tsc manually before every commit.

## VERIFY — DONE (GREEN). gate-runner: build/typecheck/test(+--filter api)/lint/format/arch/verify-fast/audit/db-drift

all PASS; the one `test` red = known chat-attribution-under-load FLAKE (chat reran 340/340 green). Independent
fresh-context review (opus): VERDICT **SHIP**, zero findings >=warn, all 7 criteria mapped to code+test file:line;
all adversarial vectors (producer-population/double-count/consent-widening/fail-open/normalization/idempotency/test-
quality) resolved against real code. 3 nits; applied nit#1 (exactly-one-entry seam test, amended into d8bc172a3).

## SURFACE — DONE. PR #1227 (https://github.com/jsonljc/switchboard/pull/1227), branch fix/contact-identity-matcher,

6 commits (3fd9e14c6 / 967e19bc0 / 7ee3813dd / 44b9f0214 / d8bc172a3). Pre-merge divergence re-check: origin/main
advanced 464d82e4f -> 91e609cb7 (3 PRs: #1225 OTel, #1224 revenue-proof, #1223 home-label) with ZERO overlap on my
18 files -> merges clean, NO rebase needed. SURFACE-before-merge: prisma+consent+receipts merge-stop -> HUMAN MERGE CALL.

gate_results: typecheck=pass test=pass(+api) lint=pass format=pass arch=pass verify-fast=pass security=pass build=pass
db-drift=pass eval=n/a(grader-confirmed not needed) review=SHIP(0 >=warn)
carry_forward: A4 COMPLETE through SURFACE. PR #1227 OPEN awaiting human merge. On merge: cleanup worktree
(git worktree remove .claude/worktrees/agents-fix-a4-identity), flip A4 checkbox in the on-main plan, update memory.
A4 intake dedup-by-reuse NOW DONE (was PARTIAL — only #1212 issuance-flag-producer existed before). NEXT slices: A5
Robin (D4), A6 Riley (D3), A7 proof-chain (watch #782), A8 Alex-booking, A9-A14.

## Log

- 2026-06-21: ORIENT complete. Worktree verified at fresh origin/main 464d82e4f. No concurrent A4 PR/branch.
  RESOLVER=Implementation. Reconciled with #1212 (clean boolean-OR seam). Design shape captured. -> FRAME.
