# Phase 0 — Wave 2 Triage Classification

**Date:** 2026-05-15
**Purpose:** Before fixing anything, classify the Wave 1 findings by _kind of risk_ so Wave 2 can be sequenced by what actually matters rather than by severity-tag alone. This note re-buckets the synthesis backlog into 5 categories; the user-approved attack sequence at the bottom uses these buckets to decide what ships when.

This is a **remap of the existing synthesis**, not a re-audit. Source: `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` + the 18 per-lane reports under `docs/audits/2026-05-15-cleanup/`.

## Category 1 — Production safety / governance

Findings that allow state-changing paths to bypass the governed operating model, or that materially weaken tenant isolation / auth. **These are not "tech debt" — they are governance holes.** Switchboard cannot afford to normalize these.

| #    | Finding                                                                                                             | Source lane                                         | Severity                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| 1.1  | `recommendations.ts:184` bypasses PlatformIngress                                                                   | doctrine-compliance + route-chain + api-consistency | CRITICAL                                   |
| 1.2  | `admin-consent.ts:66,90,113` (3 endpoints) bypass PlatformIngress                                                   | doctrine-compliance                                 | CRITICAL                                   |
| 1.3  | `lifecycle-disqualifications.ts:128,195` bypass PlatformIngress                                                     | doctrine-compliance                                 | CRITICAL (**collides PR #444**)            |
| 1.4  | `dashboard-opportunities.ts:55` bypass PlatformIngress                                                              | doctrine-compliance                                 | CRITICAL                                   |
| 1.5  | `(req as any).principalIdFromAuth` + `organizationIdFromAuth` at `apps/api/src/bootstrap/routes.ts:215,227`         | type-safety                                         | CRITICAL (auth-touching; needs own review) |
| 1.6  | Missing auth guards on 3 webhook routes (`ad-optimizer.ts:44`, `whatsapp-send-test.ts:88`, `managed-webhook.ts:68`) | api-consistency                                     | HIGH                                       |
| 1.7  | TI-7 `prisma-approval-store.ts:42-51` updateMany lacks orgId                                                        | security-sweep-delta                                | HIGH (STILL-OPEN)                          |
| 1.8  | TI-8 `prisma-lifecycle-store.ts:133-189` updateMany lacks orgId                                                     | security-sweep-delta                                | HIGH (STILL-OPEN)                          |
| 1.9  | AI-6 mutating tools bypass PlatformIngress (`calendar-book`, `crm-write`)                                           | security-sweep-delta                                | MED (architectural decision pending)       |
| 1.10 | AU-3 API key revocation 60s cache latency                                                                           | security-sweep-delta                                | MED (STILL-OPEN)                           |
| 1.11 | AU-4 auth rate limit per-IP only                                                                                    | security-sweep-delta                                | MED (STILL-OPEN)                           |
| 1.12 | TI-9 11 nullable `organizationId` fields                                                                            | prisma-hygiene + security-sweep-delta               | MED (all ORPHAN-RISK)                      |

## Category 2 — Reliability / job recovery

Findings where failures are silent: jobs die without notification, errors aren't surfaced, retries exhaust without escalation. Distinct from Category 1: these don't bypass governance — they fail invisibly.

| #   | Finding                                                                                   | Source lane              | Severity |
| --- | ----------------------------------------------------------------------------------------- | ------------------------ | -------- |
| 2.1 | Zero Inngest `onFailure` handlers across 14 async functions (launch-blocker #18 expanded) | deploy-infra-parity      | CRITICAL |
| 2.2 | `dailyPatternDecayCron` lacks `onFailure`                                                 | deploy-infra-parity      | MED      |
| 2.3 | `batch-executor-function` exported but never registered (dead async path)                 | deploy-infra-parity      | HIGH     |
| 2.4 | Sentry not initialized in `mcp-server` app                                                | deploy-infra-parity      | HIGH     |
| 2.5 | Cron registration lacks completion-event visibility                                       | deploy-infra-parity      | LOW      |
| 2.6 | 3 unimplemented `it.todo` on work-trace-update-caller-rule                                | test-stability-inventory | HIGH     |
| 2.7 | `operator-override-plumbing` it.todo blocked on respondToApproval                         | test-stability-inventory | MED      |

## Category 3 — Contract consistency

Findings about how routes/types/responses are _shaped_. Audit-trail, idempotency, error envelopes, auth guard shape, response shape, cross-app type duplication — these are all instances of "the mutating-route contract is inconsistent." **One design pattern fixes all of these.**

| #    | Finding                                                                 | Source lane              | Severity |
| ---- | ----------------------------------------------------------------------- | ------------------------ | -------- |
| 3.1  | Audit-trail gap on 48 of 64 mutating route files                        | api-consistency          | CRITICAL |
| 3.2  | Idempotency-key gap on 38 of 42 mutating routes                         | api-consistency          | CRITICAL |
| 3.3  | Error response shape inconsistency across 7+ routes                     | api-consistency          | HIGH     |
| 3.4  | ApprovalRecord type duplicated locally in 2 places                      | api-consistency          | HIGH     |
| 3.5  | ConversationState type duplicated in chat + api                         | api-consistency          | HIGH     |
| 3.6  | Handoff type missing from `@switchboard/schemas`                        | api-consistency          | MED      |
| 3.7  | Validation error structure inconsistent across routes                   | api-consistency          | MED      |
| 3.8  | Optional audit hooks on critical mutations (conversations.ts)           | api-consistency          | MED      |
| 3.9  | Surface-URL strings in core projections (4 sites)                       | surface-agnostic-backend | MED      |
| 3.10 | `DashboardOverview` type named after surface                            | surface-agnostic-backend | HIGH     |
| 3.11 | meta-deletion.ts lacks WorkTrace traceability                           | doctrine-compliance      | HIGH     |
| 3.12 | dashboard-reports.ts cache mutation lacks governance                    | doctrine-compliance      | HIGH     |
| 3.13 | whatsapp-send-test.ts lacks audit + idempotency                         | doctrine-compliance      | HIGH     |
| 3.14 | `verdictStore.save as any` cast in 5+ call sites                        | type-safety              | HIGH     |
| 3.15 | Untyped Graph API response fields in whatsapp-management                | type-safety              | HIGH     |
| 3.16 | Missing null guard on agentContext in re-engagement reader              | type-safety              | HIGH     |
| 3.17 | Allowlist gaps for whatsapp-send-test, meta-deletion, dashboard-reports | route-chain-integrity    | MED      |

## Category 4 — Maintainability

Findings that make the codebase harder to work with but don't actively break anything. These are real, but they're **not the first fire**. Pick up opportunistically or in scheduled maintenance.

| #    | Finding                                                                       | Source lane                     | Severity                          |
| ---- | ----------------------------------------------------------------------------- | ------------------------------- | --------------------------------- |
| 4.1  | 24 files >600 LOC (2 CSS >1000)                                               | file-size-splits                | CRITICAL/HIGH                     |
| 4.2  | 81 files 400–600 LOC (warn threshold)                                         | file-size-splits                | informational                     |
| 4.3  | 6 barrel files >40 exports                                                    | layer-hygiene                   | MED                               |
| 4.4  | cartridge-sdk removal readiness (245 refs, all migratable)                    | cartridge-sdk-removal-readiness | CRITICAL/HIGH (size, not urgency) |
| 4.5  | `PrismaCredentialResolver` orphan store                                       | dead-code                       | HIGH                              |
| 4.6  | 3 packages with no coverage thresholds (sdk, creative-pipeline, ad-optimizer) | coverage-vs-threshold           | CRITICAL                          |
| 4.7  | db/mcp-server/dashboard coverage below canonical                              | coverage-vs-threshold           | HIGH                              |
| 4.8  | 14 storage classes missing co-located tests                                   | missing-co-located-tests        | CRITICAL                          |
| 4.9  | 14 platform-ingress/work-trace modules missing co-located tests               | missing-co-located-tests        | CRITICAL                          |
| 4.10 | 20+ db stores beyond the core 14 also missing tests                           | missing-co-located-tests        | HIGH                              |
| 4.11 | 12 core services/engines without tests                                        | missing-co-located-tests        | HIGH                              |
| 4.12 | 19 recent ad-optimizer modules without tests                                  | missing-co-located-tests        | HIGH                              |
| 4.13 | 10 Prisma `@@index` / `@@unique` names >63 chars                              | prisma-hygiene                  | MED                               |

## Category 5 — Documentation / hygiene

Findings about docs, comments, lint, naming. Zero runtime risk. Bundle as scheduled cleanups.

| #    | Finding                                                                     | Source lane                 | Severity             |
| ---- | --------------------------------------------------------------------------- | --------------------------- | -------------------- |
| 5.1  | ApprovalManager drift in DOCTRINE.md + ARCHITECTURE.md (deleted 2026-04-19) | doctrine-architecture-drift | CRITICAL (docs-only) |
| 5.2  | Cartridge sections describe 5 cartridges with no code                       | doctrine-architecture-drift | HIGH                 |
| 5.3  | ARCHITECTURE.md §3e references deleted ApprovalManager                      | doctrine-architecture-drift | HIGH                 |
| 5.4  | ARCHITECTURE.md missing §10 with no explanation                             | doctrine-architecture-drift | MED                  |
| 5.5  | ARCHITECTURE.md route table incomplete (12 of 66 routes)                    | doctrine-architecture-drift | MED                  |
| 5.6  | DOCTRINE.md last-updated date stale                                         | doctrine-architecture-drift | LOW                  |
| 5.7  | DOCTRINE.md §3 envelope-bridge reference outdated                           | doctrine-architecture-drift | LOW                  |
| 5.8  | 16 `console.log` in `packages/db/prisma/seed.ts`                            | lint-debt                   | LOW                  |
| 5.9  | `_stripe` and `_idSeq` prefix bugs (2 sites)                                | lint-debt                   | MED                  |
| 5.10 | 36 dashboard imports include `.js` extension                                | lint-debt                   | LOW                  |
| 5.11 | Mercury/cockpit comment references in backend modules                       | surface-agnostic-backend    | LOW                  |
| 5.12 | 9 env-gated `describe.skipIf` (quarantine-OK)                               | test-stability-inventory    | LOW                  |

---

## User-approved attack sequence

This sequencing puts governance-critical work first — Track A polish does not reduce the "can this system safely mutate business state?" risk, and that's the audit's real signal.

### Phase 1 — Ingress bypass triage + smallest safe migrations (Category 1, items 1.1–1.4)

**One PR, governance-critical.**

- Confirm the 4 bypass routes (already confirmed by 3 cross-lane findings)
- Split into:
  - **Safe now:** 1.1 recommendations, 1.2 admin-consent, 1.4 dashboard-opportunities (3 routes)
  - **Blocked by PR #444:** 1.3 lifecycle-disqualifications — document blocker in this PR's body, leave route untouched
  - **Needs design:** none currently (item 1.9 AI-6 mutating-tools is architectural; deferred)
- Migrate the 3 unblocked routes only if the intent + executor pattern is obvious from existing examples
- If pattern needs design discussion, scope this phase to just the architectural pattern doc and do migrations in Phase 1b

This PR should be small and confidence-building. It directly protects Invariant 1.

### Phase 2 — Track A mechanical bundle

**One PR, boring fixes only.**

Includes:

- 5.4 add `name:` to 10 Prisma indexes >63 chars (single migration)
- 5.6 update DOCTRINE.md timestamp
- 5.8 `console.log` → `console.error` swaps in seed.ts (16 sites)
- 5.10 strip `.js` from 36 dashboard imports (mechanical find-replace)
- 4.6 add coverage thresholds to sdk, creative-pipeline, ad-optimizer (3 file edits)
- 5.1 update DOCTRINE.md + ARCHITECTURE.md to remove ApprovalManager references (docs-only)
- Cartridge-sdk Step 1: replace 13 type-only imports `@switchboard/cartridge-sdk` → `@switchboard/schemas` (mechanical)

**Explicitly EXCLUDED from Track A:**

- 1.5 auth `as any` fix — auth-touching, deserves separate review even though one-liner
- 5.9 `_stripe` / `_idSeq` rename — runtime touches, verify no shadowing first
- Anything touching active branches (local-readiness specs, riley paths)

If a Track A item needs explanation, it doesn't belong in Track A.

### Phase 3 — Two structural designs

**Two brainstorm → spec → plan cycles, each landing as design PR on main before implementation.**

#### Design A — Mutating Route Contract (Category 3)

Covers as a single design:

- Idempotency-key enforcement (item 3.2)
- Audit-trail / WorkTrace coverage (item 3.1)
- Auth guard shape (items 1.6, 1.7, 1.8, 1.5 reviewed here)
- Response/error shape (item 3.3)
- Route classification: read-only, derived write, business-state mutation, operator-direct ledger write (items 3.11, 3.12, 3.13)
- Cross-app type duplication (items 3.4, 3.5, 3.6)
- Validation error structure (item 3.7)
- Type-safety leaks on contract surfaces (items 3.14, 3.15, 3.16)
- Surface-named types (item 3.10)
- Surface-URL strings in core (item 3.9)

Output: one design doc that defines the contract; one plan that applies it to ~90 routes; multiple small implementation PRs (probably grouped by route category).

#### Design B — Inngest Failure Contract (Category 2)

Covers as a single design:

- `onFailure` handler pattern (item 2.1)
- DLQ shape (FailedMessageStore / OutboxEvent wiring)
- Retry policy classification (recoverable vs non-recoverable failures)
- Alerting / logging hookups
- Replay semantics
- Which functions are allowed to drop vs must recover (Stripe reconciliation = must recover; pattern decay = can drop)
- Registration audit for `batch-executor-function` (item 2.3)
- Sentry parity for mcp-server (item 2.4)

Output: one design doc; one plan applying it to 14 functions + the registration cleanup.

### Phase 4 — Maintenance backlog (deferred)

Pick up opportunistically when adjacent to active work, or in scheduled monthly cleanup. Items currently in this bucket:

- 4.1 file size splits (24 files) — opportunistic, when touching a file
- 4.2 400–600 LOC informational warnings — no action unless flagged
- 4.3 barrel-file bloat — scheduled refactor, low priority
- 4.4 cartridge-sdk full removal (Steps 2–6) — scheduled
- 4.5 PrismaCredentialResolver — opportunistic
- 4.7 coverage threshold raises (db, mcp-server, dashboard) — needs test additions first
- 4.8–4.12 missing co-located tests — opportunistic, prioritize stores and platform layer when touching
- 4.13 Prisma index name docs — scheduled
- All Category 5 items not in Phase 2

### Phase 5 — Re-run deferred lanes

After in-flight workstreams merge:

- `ci-gate-gaps` after local-readiness PR-1 merges, or by 2026-05-29
- `spec-plan-rot` after named workstreams merge, or by 2026-05-29 with narrower scope

---

## Why this order

1. **Phase 1 protects doctrine.** If PlatformIngress is the sole mutating entry, every bypass is a governance hole, not tech debt.
2. **Phase 2 builds momentum.** Boring fixes pass CI and prove the audit's claims are real.
3. **Phase 3 designs the platform pattern once.** Both Mutating Route Contract and Inngest Failure Contract are "design once, apply N times" problems — patching 90 routes or 14 functions individually without a governing rule is exactly the trap to avoid.
4. **Phase 4 is the long tail.** Real but not first fire.
5. **Phase 5 closes the audit loop.** Deferred lanes re-run when their preconditions are met.

---

## Next step

Phase 1 (Ingress bypass PR for 3 unblocked routes). The user's selected first structural item is **Design A — Mutating Route Contract**, which will run in Phase 3 after Phase 1 + Phase 2 land.
