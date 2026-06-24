# activation: duplicate_contact_risk detection loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap (P2 metric-trust).

Goal: kill the hardcoded `duplicateContactRisk: false` at issuance; wire REAL write-side detection (another non-deleted contact in same org sharing this contact's non-null phoneE164 => risk) so duplicate_contact_risk fires and reaches the existing operator reconcile flow.
Authority: AUTONOMOUS-WITH-GUARDRAILS (squash-merge if schema-free + all gates green + independent review 0 findings>=warn + no merge-stop glob touched; else SURFACE-before-merge).
Task-size: standard (one bounded PR; real design call; ~4 files, 2 pkgs).
Base: origin/main @ 6a7d3c083 (re-fetched) baseline_sha: 6a7d3c08381d0c5ec2f936ce796e96b9c26c60f5
merge_safety: stop-glob touched=NO (core/receipts + core/skill-runtime tool + db store comment-only; none match prisma//migrations//auth/payment/consent/credential/governance/ingress/send/allowlist globs). schema-free (deliberate: NO @@unique(org,phoneE164) this slice). independent_review=SHIP (fresh-context agent, zero findings>=warn; 1 nit=no-change). => AUTONOMOUS-MERGE conditions MET; merging once CI green.

## ORIENT brief (tool-backed, <=120w)

- evaluate-exceptions.ts:44-46 ALREADY raises duplicate_contact_risk iff ctx.duplicateContactRisk; downstream wiring complete, only the producer boolean is dead. (read)
- build-receipted-booking-data.ts:72 hardcodes `duplicateContactRisk: false` (write/issuance path; pure fn). BuildReceiptedBookingArgs has NO such field. (read)
- issue-receipted-booking.ts:91 is the SOLE caller of buildReceiptedBookingData; runs inside calendar-book.ts:512 governed booking tx; already org-scoped reads tx.contact for evidence. (read+grep)
- prisma-receipted-booking-store.ts:190 keeps `false` on the READ path by design; surfaces dup-risk ONLY via persisted-array carry (assembleViewExceptions). (read)
- Contact.phoneE164 String? nullable, indexed @@index([organizationId, phoneE164]); Contact has NO soft-delete column => "non-deleted" == "exists". (schema read)
- No in-flight PR/worktree touches duplicate_contact_risk (gh pr list + git worktree list). Gap REAL.

## DESIGN (self-driven brainstorm; user pre-authorized "decide yourself, never ask")

DECISION: write-side (issuance-time) detection ONLY. Read path stays `false`.

- WHY write-side, not read-side-lazy: assembleViewExceptions makes a recomputable code WIN and drop the persisted same-code entry — INCLUDING a resolved one. So a read-side recompute would re-open every operator-RESOLVED duplicate on each read (resolve would never stick) AND incur N+1 across listForCohort (N x getView, each probing). Write-side persists the flag into the issuance row's exceptions array once; the read path carries it; resolve_exception sets resolvedAt and the carry filter `!e.resolvedAt` drops it => resolve is durable. This is why the slice's "kill the false at store:190 too" is the WRONG move; store:190 stays false (I only sharpen its now-imprecise comment).
- MATCH KEY: exact equality on the phoneE164 column (already the canonical E.164 form producers normalize). No re-normalization of raw `phone`. Org-scoped, exclude self (id != contactId).
- NULL/EMPTY: skip the probe entirely when phoneE164 is null/undefined/empty/whitespace-only (no dedup key => risk=false; two empties are a data-quality artifact, not an identity collision).
- PERF: one extra indexed findFirst (existence, select id) per ISSUANCE only, on the existing (organizationId, phoneE164) index. Read path untouched => no cohort N+1.
- IDEMPOTENCY: issuance is findFirst-then-create; detection runs exactly once at first issuance (re-detection on read deliberately rejected — see resurrection above).
- ACCEPTED LIMITATION (logged, never silent): detection is issuance-time; a duplicate contact created AFTER this booking's issuance won't retroactively flag THIS booking (the later contact's own booking flags; operator flag_duplicate covers the manual case). Retroactive detection = future re-evaluation-job slice.
  REJECTED: (a) read-side-lazy recompute (resurrects resolved dups + N+1); (b) @@unique(org,phoneE164) schema constraint (out of scope, would make slice non-auto-mergeable; deliberate follow-on); (c) normalizing raw `phone` (phoneE164 is the canonical key).

## PROCESS DECISION (recorded)

Implement INLINE (4 small interdependent files; design subtlety is mine to hold), but MANDATORY-delegate the VERIFY gate-run AND the fresh-context independent review to subagents (non-self-gradable + context-heavy). Honors build-loop spirit (context discipline + independent review) without fragmenting a tightly-coupled change.

| step | done-condition (test/cmd)                                                                                                | RED proof                                                   | status | evidence (cmd->result / file:line)                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| 1    | build-data: arg threaded; pin test `duplicateContactRisk:true => code present` GREEN                                     | RED seen: "expected [] to include 'duplicate_contact_risk'" | DONE   | build-data.test 7/7 GREEN                                    |
| 2    | issuance: phoneE164 select + dup probe + pass boolean; tests (dup=>flag / nodup=>none / null-empty=>no-probe+none) GREEN | RED seen: probe never issued (only evidence read by id)     | DONE   | issue-receipted-booking.test 9/9 GREEN; core typecheck clean |
| 3    | db store:178-190 comment sharpened (resolve-durability rationale); NO behavior change; db tests stay green               | n/a (doc)                                                   | DONE   | db store 31/31 GREEN                                         |

gate_results (verifier subagent, post-edit): typecheck=pass test=pass(1 chat-attr flake, isolated rerun green) lint=pass(pre-existing warns) format=pass arch=pass verify-fast=pass security=pass(audit exit0; advisories pre-suppressed+code-indep) build=pass eval=n/a(no engine/gate touch) review=SHIP(0>=warn)
carry_forward (<=150 words): committed 8f4a3f759 -> rebased onto origin/main@d07f8658f (#1210 chat, disjoint) = 46082e4f0; fast re-verify GREEN (typecheck + 16 + 31). Pushed; PR #1212 OPEN. CI watch bg=b3ppnczxd. NEXT: on CI green -> squash-merge --delete-branch (worktree gotcha: local switch errors but remote merge succeeds; verify gh pr view then ff-sync main + remove worktree) -> update memory note project_north_star_activation_gap.

## STATUS: DONE / MERGED to main = 103237a5a (PR #1212, squash, 2026-06-21). Worktree removed, branch deleted, memory updated.

RECONCILIATION (vs all-agents plan, now on main b1c53b3b5): this slice = ISSUANCE-side detection ONLY (the flag-producer half), deliberately schema-free + auto-mergeable. It does NOT implement A4's intake matcher (lead-intake-handler.ts findByPhoneOrEmail + dedup-by-REUSE + consent-consolidation + prisma migration), which remains OPEN. No conflict: my change is in issueReceiptedBookingInTx (not lead-intake-handler.ts); the duplicateContactRisk arg I added is plumbing A4 can reuse; flag is idempotent (one-open-per-code) so no double-flag. Corrected MEMORY.md "A4 done" -> "A4 PARTIAL".

## Log

- 2026-06-21: ORIENT done (gap real, all claims tool-backed). Worktree off origin/main@6a7d3c083. Brainstorm self-driven -> write-side detection locked (read-side rejected: resurrects resolved dups). PLAN ephemeral (.claude/activation-dup-contact-detect-plan.md). EXECUTE TDD: step1 RED->GREEN, step2 RED->GREEN (+ test-mock typecheck fix: ContactRead alias), step3 doc. Committed -> rebased onto #1210 -> VERIFY (verifier subagent ALL_GREEN + fresh independent review SHIP). PR #1212. -> CONVERGE (autonomous merge on CI green).
