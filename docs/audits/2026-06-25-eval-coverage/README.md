# Switchboard Eval-Coverage Map (2026-06-25)

A read-only fan-out across the whole monorepo to answer one question: **what kinds of evals
should we run across Switchboard, and where is the coverage actually missing?** This is the
durable findings record; the PR-sized slices that close these gaps live in
[`docs/superpowers/plans/2026-06-25-eval-coverage-plan.md`](../../superpowers/plans/2026-06-25-eval-coverage-plan.md).

- **Method:** six parallel agents, one per surface (existing-infra inventory, agent capability,
  governance/consent, platform spine, ad/creative/measurement, channel/delivery/isolation).
  Each agent both inventoried the _existing_ coverage and proposed the _missing_ evals, grounded
  in `file:line`. Findings consolidated and de-duplicated here.
- **Framing:** "eval" spans the codebase's full quality idiom: deterministic unit assertions,
  LLM-judge / rubric scoring, trajectory grading, contract/seam parsing, and (newly proposed) a
  real-Postgres integration tier. The kinds are organized below as a taxonomy so the answer to
  "what kinds" is the section headings.
- **Honesty caveats:** the candidate defects were agent-found with `file:line`, then an independent
  3-reviewer pass verified each against `main`: BUG-1 was already fixed (#1269), BUG-10's path was
  corrected, the rest were confirmed; coverage-column statuses were spot-checked and corrected
  (MONEY-1/2, SPINE-3, GOV-2/3). Severities are coverage-risk judgments, not incident grades. `main`
  moves fast (A19/#1278, A20/#1281 merged mid-audit) - re-check `gh pr list` before starting a slice.

---

## The existing eval stack (the baseline - do not rebuild)

Switchboard already has an unusually mature stack for its size. Anchor here before adding anything.

| Mechanism                                    | Evaluates                                                                                                                                                                             | Type                                                                                       | Runs                                                                             | Maturity                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------- |
| `evals/alex-conversation/`                   | Alex replies over ~80 fixtures (refusal, qualify-before-book, safety escalation, code-switch, claim safety)                                                                           | 3-tier: deterministic oracle + LLM-judge hard rules + 0-5 soft score; baseline-drift-gated | deterministic suite **blocking**; live LLM scoring **informational / key-gated** | partial (live leg parked)    |
| `evals/claim-classifier/`                    | Medical-claim classifier accuracy vs live Haiku                                                                                                                                       | LLM-invoked + deterministic scoring, prompt-hash drift gate                                | deterministic blocking; live run needs `ANTHROPIC_API_KEY`                       | partial (key-blocked)        |
| `evals/governance-decision/`                 | Full `EffectCategory x TrustLevel` (7x3) grid + overrides                                                                                                                             | deterministic, model-free, DB-free; drift guard vs live policy                             | **fully blocking**                                                               | mature                       |
| `evals/riley-recommendation/`                | `decideForCampaign` outcome matrix + arbitration + source-reallocation                                                                                                                | deterministic, model-free; denominator + coverage drift guards                             | **fully blocking**                                                               | mature                       |
| `evals/trajectory-grading/`                  | Recorded tool-call trajectory vs the real governance gate                                                                                                                             | deterministic; oracles each recorded decision against `getToolGovernanceDecision`          | **fully blocking**                                                               | mature (golden-fixture only) |
| `packages/core/.../classifier/eval/`         | Cross-model Haiku vs Sonnet classifier agreement                                                                                                                                      | LLM-invoked, soft-gated, `EVAL=1`                                                          | manual only                                                                      | partial (never wired)        |
| `packages/sdk/src/testing/`                  | Drives an `AgentHandler` through fake providers with trust-level -> approval routing                                                                                                  | deterministic mock providers                                                               | library, per-package                                                             | mature                       |
| CI static gates (`.github/workflows/ci.yml`) | typecheck, coverage (global 55/50/52/55, core 65/65/70/65), `pnpm audit`, gitleaks, CodeQL, dependency-cruiser layers, `check-routes --mode=error`, env/route allowlists, seed counts | static / coverage                                                                          | **blocking**                                                                     | mature                       |

Test conventions: co-located `*.test.ts`; db unit tests mock Prisma in-process. **A
`DATABASE_URL`-gated real-Postgres tier already exists** in `packages/db` (`describe.skipIf(!process.env.DATABASE_URL)`,
e.g. `prisma-work-trace-store-integrity.test.ts`, `prisma-greeting-signal-store.test.ts`,
`prisma-ledger-storage.test.ts`); it is just not run as a CI job today (INFRA-2 extends it).
api/chat tests under `src/**/__tests__/`; dashboard has its own vitest step (40/35/40/40).

---

## Verdict

The gaps cluster in **five places**, and the fan-out surfaced **11 candidate defects** an eval
would have caught. An independent verification pass (2026-06-25) checked each against `main`:
**9 confirmed live at the audited path** (BUG-2..9, BUG-11), **BUG-10 confirmed at a corrected path**
(`meta-capi-client.ts`, not `meta-ads-client.ts`), and **BUG-1 already fixed** on `main` via #1269
(kept below as a regression-guard target).

1. **No adversarial / injection evals exist for any LLM agent** (largest categorical hole).
2. **No live-LLM eval gates anything** - every blocking eval today is deterministic; the
   real-model legs are non-blocking or blocked on the parked `ANTHROPIC_API_KEY`.
3. **Mira and Robin have no agent eval harness** (only Alex and Riley do); Riley's _LLM_ surface
   is untested for judgment (the engine is well covered).
4. **Half the highest-value spine invariants cannot be proven under mocked Prisma** - referential
   integrity, true unique-constraint races, transaction isolation, org-scope WHERE. A small
   **real-Postgres integration tier** is the single highest-leverage structural addition.
5. **The regulated (medspa) creative path has no claim-safety eval** - `claimsPolicyTag` is
   captured but never enforced; QA scores realism only and deliberately refuses claim judgment.

No core invariant is broken (PlatformIngress, WorkTrace-canonical, approval-as-lifecycle, no
mutating bypass all hold in code). The dominant theme is **untested fail-open / fail-closed
branches and cross-store seams**, the same family as `feedback_safety_gate_needs_producer_population`
and `feedback_threaded_outcome_failclosed_at_seam`.

---

## Live defects the fan-out surfaced (fix-and-eval, not just coverage)

Ordered by blast radius. `[confirmed]` = verified live against `main`; `[RESOLVED]` = already fixed
(now a regression-guard target); `[verify]` = reproduce before asserting.

- **BUG-1 `[RESOLVED on main, #1269]` - `Booking.workTraceId` join was broken for every booking.**
  This was the real A7b bug: producer `packages/core/src/skill-runtime/tools/calendar-book.ts:371`
  writes `workTraceId: ctx.workUnitId`, but the consumer joined it against `WorkTrace.id` (the cuid
  PK), leaving `traceId` / `matchedPolicies` / `approvalId` null for every booking. **PR #1269
  (`a102b1ef0`) fixed it**: `prisma-receipted-booking-store.ts:140-141` now joins on
  `workUnitId` (`@unique`), and `packages/core/.../channel-gateway/channel-gateway.ts:153` records
  `response.result.workUnitId`. The stored value already equalled `workUnitId`, so **no backfill was
  needed**. Kept here only because the proof-chain join is exactly the kind of cross-store seam
  mocked Prisma cannot guard - SPINE-1 is now a **regression eval** on top of the merged fix, not a
  pending bug.
- **BUG-2 `[confirmed, A8b]` - stranded `running` claim has no dead-letter or operator visibility.**
  A process death between `claim()` and `finalizeTrace` leaves a `running` WorkTrace that
  permanently, non-retryably blocks every future submit of that idempotency key. The permanent block
  is **deliberate and load-bearing**: the claim is committed before the domain mutation dispatches,
  so the mutation may have committed; `platform-ingress.ts:120-142` fails closed "to avoid a
  double-apply; manual reconciliation required" (Doctrine #6: ingress is the sole idempotency guard).
  The real gap is that there is **no `findStuck` / age-out to a dead-letter terminal state and no
  operator alert** - the row blocks silently forever. The fix is a reaper that ages it to a
  non-resubmittable `needs_reconciliation` sink + alert, NOT one that reopens the key.
- **BUG-3 `[verify]` - governance per-execution constraints have zero runtime effect.**
  `skill-mode.ts:93` forwards only `constraints.trustLevel`; `maxToolCalls` / `maxLlmTurns` /
  `maxTotalTokens` / `maxRuntimeMs` are dropped, and the executor enforces a constructor-time
  default policy, not the per-request constraints. `maxWritesPerExecution` is computed for the
  trace summary but enforced nowhere.
- **BUG-4 `[verify]` - Telegram 64-byte `callback_data` cap unhandled** (`telegram.ts:220`). A
  long approval `callbackData` is silently rejected by Telegram, so the operator cannot
  approve/reject (lost control-plane action).
- **BUG-5 `[confirmed]` - Instagram `verify_token` uses plain `===`** (`instagram.ts:118`) while
  its own signature path (`:107`) is timing-safe and the WhatsApp adapter (`whatsapp.ts:115-117`)
  uses length-check + `timingSafeEqual` for verify_token too. Genuinely inconsistent, but low
  severity (P2, see CHAN-5): verify_token is checked once at webhook setup.
- **BUG-6 `[confirmed]` - JSON-unsafe Inngest payload.** `mode-dispatcher.ts:29` and `:38` both put
  `dispatchedAt: new Date()` (not `.toISOString()`) into a step event payload; downstream can
  receive `null` after replay. A `mode-dispatcher.test.ts` exists but asserts `data` via
  `objectContaining` and never checks `dispatchedAt`, so the defect is uncovered.
- **BUG-7 `[verify]` - `listTasteCandidates` Leg-2 take-before-filter starvation**
  (`prisma-creative-job-store.ts:388-425`): `take:limit` then JS-filters to redecided rows, so if
  the newest `limit` are all non-redecided, older redecided rows starve.
- **BUG-8 `[verify]` - `claimsPolicyTag` captured but never enforced** in the creative pipeline
  (`ugc/ugc-script-writer.ts`). No medical-claim rubric anywhere; for a medspa vertical this is
  the biggest creative-side exposure.
- **BUG-9 `[verify]` - inbound revocation gate fails OPEN on resolver error**
  (`consent-revocation-gate.ts:31-55`): during a governance-config outage a customer "STOP"
  keyword is not captured (returns `"proceed"`). The symmetric _egress_ branch is tested; this
  inbound one is not. Needs a deliberate fail-open-vs-closed decision plus an eval.
- **BUG-10 `[confirmed, corrected path]` - `fbc` timestamp hardcodes `Date.now()`** at
  `meta-capi-client.ts:36` (NOT `meta-ads-client.ts:36`, which is a `RateLimitError`) while the same
  client sets `event_time` correctly. The right dispatcher (`meta-capi-dispatcher.ts`) uses
  `buildFbc(fbclid, fbclidTimestamp ?? occurredAt)`. Stale-click mis-attribution risk; the residual
  half of the "rank-20 CAPI occurredAt" memory item (the dispatcher's `event_time` itself is correct).
- **BUG-11 `[verify]` - `sweepExpiredLifecycles` defined but not registered**, and
  `listExpiredPendingLifecycles` is unbounded (full scan on a mass batch).

---

## Eval gap inventory (the taxonomy = the "what kinds" answer)

Each row: **ID | what to assert | severity | existing coverage**. Severity: P0 live correctness,
P1 high-risk untested branch (money / tenant / consent), P2 important coverage, P3 robustness/polish.

### 1. Agent behavioral evals (LLM judgment) - `AGENT-*`

| ID       | Assert                                                                                                                                   | Sev | Coverage                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------- |
| AGENT-1  | Alex: `pending_approval` booking return is not over-claimed as confirmed; no deposit/escalate                                            | P1  | none                                     |
| AGENT-2  | Alex: reschedule/cancel handled directly (not escalated); deposit issued only after confirmed                                            | P2  | none (tool-unit only)                    |
| AGENT-3  | Alex: out-of-area disqualification; no booking                                                                                           | P2  | none                                     |
| AGENT-4  | Alex: no invented price / availability / refund policy / branded treatment (grounding)                                                   | P1  | partial (hedge-word regex + empty-facts) |
| AGENT-5  | Alex: tool-arg schema parity - mock tools imported from the **real** exported tool defs, not frozen literals (the "mock-tool-blind" fix) | P1  | none (literals only)                     |
| AGENT-6  | Alex: BM/Malay output quality graded (MY wedge), not only English-equivalent rules                                                       | P2  | partial                                  |
| AGENT-7  | Riley: live-model judgment over `ao-*` scenarios (not canned replays)                                                                    | P1  | none (mock-replay)                       |
| AGENT-8  | Mira: real-generation propose/abstain + claim-cleanliness graded vs a baseline                                                           | P1  | none (shape-only on fixtures)            |
| AGENT-9  | Mira: no cross-agent contract bleed (no `<intent>` / `<qualification_signals>` in a brief) via the **real** downstream parser            | P2  | partial (fixture strings)                |
| AGENT-10 | Robin: live window-gate end-to-end (`no_optin` via the real thread read), not only unit-isolated                                         | P2  | partial                                  |

### 2. Adversarial / safety evals - `ADV-*` (currently zero across all agents)

| ID    | Assert                                                                                                                                                                             | Sev | Coverage                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------- |
| ADV-1 | Shared prompt-injection corpus run against Alex (inbound msg), Riley (campaign names), Mira (taste/facts): ignore-instructions, reveal-prompt, set-price/deposit/budget, role-swap | P1  | none                              |
| ADV-2 | Claim-boundary suite run with the claim classifier both ON and OFF (it is inert in prod today)                                                                                     | P1  | partial (prompt-only baited once) |
| ADV-3 | Malformed/adversarial input robustness (empty, 10k emoji, mixed-script, script-ish payloads) degrades gracefully, no crash, no tool-arg injection                                  | P2  | none                              |

### 3. Governance / consent / approval evals - `GOV-*`

| ID     | Assert                                                                                                                                                                | Sev | Coverage                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GOV-1  | Inbound revocation-gate fail-open on resolver error (BUG-9): pin behavior + `gateway_resolver_error_fail_open` audit; force a fail-open-vs-closed decision            | P1  | none                                                                                                                                           |
| GOV-2  | A19 booking-consent resolver-error coercion (error -> enforce-if-last-known-enforce else off; missing -> off) + `bookingConsentResolverError` counter                 | P1  | **yes** (#1278 A19 test: error+warm-enforce BLOCKS, granted ALLOWS, cold/missing->off inert, + `bookingConsentResolverError` counter asserted) |
| GOV-3  | Per-org operator-channel binding isolation: org-B query never returns org-A binding; revoked binding never returned                                                   | P1  | none for the store's SQL org-isolation (consumer-level revocation IS tested: internal-chat-approvals.test.ts:261)                              |
| GOV-4  | `writeApprovedPayloadToTrace` rejection leaves lifecycle approved-but-undispatched, nothing executed                                                                  | P2  | none (`lifecycle-dispatch.ts:79-82`)                                                                                                           |
| GOV-5  | Store terminal-transition cannot seal a `completed` trace without a `governanceOutcome==="execute"` claim (the bypass-guard's documented scope hole)                  | P2  | gap-by-design                                                                                                                                  |
| GOV-6  | CTWA inside-window allow writes no durable `messagingOptIn`; `messagingOptInSource:"ctwa"` alone does not satisfy the outside-window opt-in gate; no-regreeting reuse | P1  | partial (window-inside allow only)                                                                                                             |
| GOV-7  | Empty-approvers + no-fallback (`denyWhenNoApprovers=false`) cannot silently auto-pass                                                                                 | P2  | none (`router.ts:64-77`)                                                                                                                       |
| GOV-8  | Banned-phrase block survives `handoffStore` / `conversationStore` persistence throws (only `verdictStore` throw is tested)                                            | P2  | partial                                                                                                                                        |
| GOV-9  | Idempotency replay after org de-entitlement still returns cached (pin the intentional behavior)                                                                       | P3  | none                                                                                                                                           |
| GOV-10 | NaN/Infinity spend fails toward require-approval, not silent auto-approve, across all four guarded sites                                                              | P2  | partial                                                                                                                                        |

### 4. Platform-spine evals - `SPINE-*`

| ID       | Assert                                                                                                                                                                                                                                                                                                          | Sev | Coverage                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------- |
| SPINE-1  | `Booking.workTraceId` -> WorkTrace join integrity, **regression guard over merged #1269** (BUG-1); receipted-booking surfaces non-null `traceId`/`matchedPolicies`/`approvalId`; strong attribution resolves                                                                                                    | P2  | fix merged #1269; add regression eval - real-PG tier                                                                             |
| SPINE-2  | Stranded `running` claim (BUG-2): a reaper ages the orphan to a **non-resubmittable** terminal (a new `needs_reconciliation` outcome - needs `WorkOutcome`-union + `ALLOWED_OUTCOME_TRANSITIONS`/`TERMINAL_OUTCOMES` edits - or reuse `failed`) + operator alert + extended replay guard; NEVER reopens the key | P1  | none                                                                                                                             |
| SPINE-3  | Governance constraints reach (or are knowingly dropped at) the executor (BUG-3): `constraints.maxToolCalls:1` is honored, or the drop is test-flagged; `maxWritesPerExecution` bounds writes                                                                                                                    | P1  | partial (skill-mode.test.ts:56-70 injects via constraints but never asserts budget reaches/dropped at executor; BUG-3 confirmed) |
| SPINE-4  | Prod-inert intent matrix: `resolveMode` throws on unseeded; auto-execute cron-intent needs allow-gov + PLATFORM_DIRECT + handler + schedule trigger + seeded `system` actor (all-or-inert)                                                                                                                      | P2  | partial (scattered)                                                                                                              |
| SPINE-5  | At-most-once pre-send claim ordering: claim / `nextRetryAt`-clear precedes the network send; post-send write failure leaves the row not-due (stranded-sent, never double-sent)                                                                                                                                  | P1  | partial (store dedups via unique key, ordering not pinned)                                                                       |
| SPINE-6  | Outbox / unique-constraint real enforcement (`skipDuplicates`, `(org, idempotencyKey)` + `dedupeKey` P2002 races, advisory-lock serialization, `getByIdempotencyKey` org-scope)                                                                                                                                 | P1  | partial (hand-fed at mock layer) - real-PG tier                                                                                  |
| SPINE-7  | JSON-safe Inngest step payloads (BUG-6): no `Date`/`undefined`; `dispatchedAt` is ISO                                                                                                                                                                                                                           | P2  | none (mode-dispatcher)                                                                                                           |
| SPINE-8  | `listTasteCandidates` Leg-2 starvation (BUG-7): an older redecided row still returns under a full newest-N non-redecided page                                                                                                                                                                                   | P2  | none - real-PG tier                                                                                                              |
| SPINE-9  | dual-lifecycle `currentStage` vs `ugcPhase`: a UGC-complete job with stale `currentStage` reads as terminal, not stuck                                                                                                                                                                                          | P2  | partial                                                                                                                          |
| SPINE-10 | Inngest replay does not double-execute / regress a terminal job (publish-chain early-return matrix)                                                                                                                                                                                                             | P2  | partial                                                                                                                          |
| SPINE-11 | `sweepExpiredLifecycles` registered + bounded query (BUG-11)                                                                                                                                                                                                                                                    | P2  | partial                                                                                                                          |
| SPINE-12 | `safeParse` at JSON/store seams: malformed stored payload -> typed default, never a throw that aborts the path (a dozen sites unevenly covered)                                                                                                                                                                 | P2  | partial                                                                                                                          |

### 5. Money / measurement evals (pre-real-money-flip gate) - `MONEY-*`

| ID       | Assert                                                                                                                                                     | Sev | Coverage                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| MONEY-1  | No-compound-runaway: sum of deltas across N audit cycles and across multiple campaigns in one cycle stays within cap; arbitration submits only the primary | P1  | partial (`opportunity-arbitrator.test.ts` covers single-pass arbitration + primary-only; the multi-cycle compounding sum is the residual gap) |
| MONEY-2  | Measurement-untrusted hold blocks cost-driven/learning-resetting actions when the conversion denominator is suspect                                        | P1  | **yes** (campaign-decision.test.ts:75,199 assert the `measurement_untrusted` watch) - drop from gate                                          |
| MONEY-3  | Source-reallocation blocked below the 0.7 spend-attribution coverage floor                                                                                 | P2  | partial                                                                                                                                       |
| MONEY-4  | CAPI `event_time` = conversion time end-to-end (Booking T -> event), and resolve the `meta-capi-client.ts:36` `Date.now()` fbc path (BUG-10)               | P1  | partial (dispatcher boundary only)                                                                                                            |
| MONEY-5  | CTWA -> booked-leg `ctwa_clid` preservation through contact folding; never mis-assigns campaign                                                            | P1  | none (full chain)                                                                                                                             |
| MONEY-6  | Conversion dedup / `event_id` determinism on retry; decide whether an app-level sent-event ledger is required vs relying on Meta's window                  | P1  | partial (no app-level guard)                                                                                                                  |
| MONEY-7  | Creative medical-claim safety LLM-judge on generated scripts/hooks; enforce `claimsPolicyTag` (BUG-8); hallucinated-offer + forbidden-phrase enforcement   | P1  | none                                                                                                                                          |
| MONEY-8  | Execution-flag default-OFF wiring: with `RILEY_*_SELF_EXECUTION_ENABLED` unset, no submitter is wired; pause needs env AND per-org                         | P1  | partial                                                                                                                                       |
| MONEY-9  | `MetaAdsClient` fresh-instance-per-call usage contract (the 60s per-instance limiter) at the dispatch call sites                                           | P2  | partial (interval tested, call-site contract not)                                                                                             |
| MONEY-10 | Sane-ceiling + NaN/Infinity guards on `updateCampaignBudget` asserted directly (100x-encoding tripwire)                                                    | P2  | partial                                                                                                                                       |

### 6. Channel / delivery / isolation / app evals - `CHAN-*`

| ID      | Assert                                                                                                                                                                                                                                                                                    | Sev | Coverage                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------- |
| CHAN-1  | Cross-tenant route sweep for the uncovered allowlisted routes: `knowledge`, `knowledge-entries`, `conversations`, `audit`, `policies`, `competence`, `token-usage`, `contacts`, `opportunities`, `automations`, `scheduled-reports`, `webhooks`-registry (org A cannot read/mutate org B) | P1  | none                            |
| CHAN-2  | Deferred-store data-layer isolation: the `store-mutation-deferred` suppressed stores carry orgId in WHERE (the CI gate is advisory only, `exitCode 0`)                                                                                                                                    | P1  | advisory only                   |
| CHAN-3  | Webhook -> org binding for a 2-org registry routes each webhook to the correct org (inbound mirror of the FROM-number leak)                                                                                                                                                               | P1  | partial                         |
| CHAN-4  | Telegram `callback_data` cap (BUG-4): long callbackData truncated/encoded to <=64 bytes before send                                                                                                                                                                                       | P1  | none                            |
| CHAN-5  | Instagram `verify_token` timing-safe compare (BUG-5)                                                                                                                                                                                                                                      | P2  | none                            |
| CHAN-6  | Duplicate WhatsApp status callback idempotency (same `messageId` status twice -> no double-count)                                                                                                                                                                                         | P2  | none                            |
| CHAN-7  | Session-token cross-org use rejected; dashboard API-client cannot decrypt another org's key                                                                                                                                                                                               | P1  | none (issuance-only / implicit) |
| CHAN-8  | Cross-channel STOP is org+contact-scoped (a different org's same-phone contact unaffected)                                                                                                                                                                                                | P2  | partial                         |
| CHAN-9  | Approval-card platform limits: WhatsApp <=3 buttons / 20-char titles, IG <=3 quick-replies truncation enforced                                                                                                                                                                            | P2  | partial                         |
| CHAN-10 | Robustness: oversized / deeply-nested webhook bounded; Slack >5-min timestamp rejected; malformed-payload + silent flow-JSON-parse-swallow surfaced                                                                                                                                       | P2  | partial                         |
| APP-1   | Dashboard fetch hooks `use-agent-pipeline` / `use-decision-feed` / `use-mira-feed` have loading/error/data + org-scoped-key tests                                                                                                                                                         | P2  | none                            |
| APP-2   | Dashboard prod-env preflight: missing `DATABASE_URL` / `CREDENTIALS_ENCRYPTION_KEY` fails safely; `DEV_BYPASS_AUTH` refused in prod                                                                                                                                                       | P2  | partial                         |
| APP-3   | Loading-state gating (`enabled:false` -> `isLoading=false`) enforced as `!data && !error` beyond the one guarded section                                                                                                                                                                  | P3  | partial                         |

### 7. Eval-infrastructure upgrades - `INFRA-*`

| ID      | Assert / build                                                                                                                                                                                      | Sev | Coverage                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------- |
| INFRA-1 | Make the real-LLM evals **blocking**, not key-gated: restore `ANTHROPIC_API_KEY` in Actions, un-park the Alex baseline bake, gate prompt/tool changes                                               | P1  | parked                                      |
| INFRA-2 | **Extend** the existing `DATABASE_URL`-gated PG tier in `packages/db` into a CI job (it has no job today) so SPINE-1/6/8 + CHAN-2 can run; reuse `DATABASE_URL`, do NOT invent `INTEGRATION_DB_URL` | P1  | partial (skip-gated tests exist; no CI job) |
| INFRA-3 | Add a **Mira** agent eval harness (`evals/mira-*`) and a **Robin** behavioral eval lane (none exist)                                                                                                | P1  | none                                        |
| INFRA-4 | Wire the resolver routing eval (`.agent/evals/resolver-evals.json` is a 7-case dataset with no runner)                                                                                              | P3  | none                                        |
| INFRA-5 | Give `apps/api` and `apps/chat` their own coverage thresholds (today they inherit only the root global)                                                                                             | P3  | none                                        |

---

## Where to start

1. **SPINE-2** (stranded-`running` dead-letter + alert): the one genuine P0/P1 correctness gap still
   open (BUG-1 was fixed by #1269; SPINE-1 is now just a regression eval). Fix it as a
   non-resubmittable dead-letter, NOT an auto-reopen. SURFACE.
2. **INFRA-2** (CI job over the existing PG tier) - it unblocks the SPINE-1 regression eval plus
   SPINE-6/8 and CHAN-2.
3. **ADV-1 + ADV-2 + ADV-3** (zero injection/claim/robustness coverage; regulated vertical;
   classifier inert in prod).
4. **INFRA-1 + AGENT-5** (make Alex's eval blocking and fix the mock-tool-blindness), then **INFRA-3**
   (Mira real-generation eval).
5. **The MONEY-\* pre-flip gate** before Riley/Mira touch real spend, then **CHAN-1** (cross-tenant
   route sweep).
