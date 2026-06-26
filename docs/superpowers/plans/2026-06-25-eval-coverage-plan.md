# Eval-Coverage Plan (2026-06-25)

PR-sized slices that close the gaps in
[`docs/audits/2026-06-25-eval-coverage/README.md`](../../audits/2026-06-25-eval-coverage/README.md).
Each slice maps to stable gap IDs (`AGENT-*`, `ADV-*`, `GOV-*`, `SPINE-*`, `MONEY-*`, `CHAN-*`,
`APP-*`, `INFRA-*`) from that audit. **No new product scope is invented here - every slice adds an
eval, or fixes a defect an eval would catch.** One slice (EV-2) carries a confirmed live bug; EV-1
is a regression eval over the already-merged #1269 fix; the rest of the bug-bearing slices must
reproduce the defect before asserting it.

## Build-loop protocol

- **One slice per fresh session, off `main`, in a new worktree:** `git worktree add
.claude/worktrees/<slug> -b <branch> main && cd .claude/worktrees/<slug> && pnpm worktree:init`.
- **Process:** brainstorm only if the design is genuinely open (most slices below have a
  determined design); then TDD execute; request an independent code review; verify; merge clean
  (squash, conventional commit, `--delete-branch`); confirm `gh pr checks` green; ff-sync `main`;
  remove the worktree.
- **A new eval that calls a live model** must never spend in a normal CI run. There are three live
  idioms already in the repo - use the one that matches the harness: (a) `evals/*` tsx scripts gate
  via a runtime branch (soft-skip on a branch, hard `exit(2)` on a `main` push when the key is
  absent - see `evals/claim-classifier/eval-preflight.ts`); (b) in-package vitest suites use
  `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`; (c) the older core classifier eval gates on
  `EVAL=1`. Do NOT invent a `skipIf + EVAL=1` combo - that pattern exists nowhere. The blocking legs
  stay deterministic; **INFRA-1 restoring a working key is a hard precondition** for flipping any
  live leg to blocking.
- **Real-Postgres slices** (SPINE-1, SPINE-6, SPINE-8, CHAN-2) reuse the existing `DATABASE_URL`
  skip-gate (`describe.skipIf(!process.env.DATABASE_URL)`, already used in `packages/db`). EV-16 only
  adds the CI job that sets `DATABASE_URL`; do NOT invent an `INTEGRATION_DB_URL`. Write the eval
  skip-guarded on `DATABASE_URL` so it runs locally and in the EV-16 job, no-ops elsewhere.
- **Per-commit hygiene:** `pnpm --filter <pkg> exec tsc --noEmit` per touched package (pre-commit
  is eslint+prettier only); rebuild each lower package's `dist` after its task so api/chat tsc and
  the eval harnesses see new types; a new `SwitchboardMetrics` counter needs all three registries
  (core in-memory + api & chat prom); `pnpm format:check` before push.
- **Money / multi-tenant / governance / consent slices SURFACE before merge** (human merge call):
  EV-2, EV-9a, EV-9b, EV-11, EV-12, EV-13, EV-14. (EV-1 became a test-only regression guard over the
  merged #1269 fix - no behavior change, no SURFACE.)

## Slice ledger

| Slice | Closes                              | Theme                               | Sev | SURFACE | Status         |
| ----- | ----------------------------------- | ----------------------------------- | --- | ------- | -------------- |
| EV-1  | SPINE-1                             | proof-chain join regression (#1269) | P2  | -       | not started    |
| EV-2  | SPINE-2 (BUG-2) + SPINE-5           | at-most-once delivery safety        | P1  | yes     | surfaced #1292 |
| EV-3  | ADV-1 + ADV-3 (Alex live)           | injection + input-robustness suite  | P1  | -       | merged #1323   |
| EV-3b | ADV-1 (Riley live)                  | Riley campaign-name injection lane  | P1  | -       | with EV-7      |
| EV-3c | ADV-1 (Mira live)                   | Mira taste/facts injection lane     | P1  | -       | unblocked by EV-6 |
| EV-4  | ADV-2                               | claim-boundary (classifier on/off)  | P1  | -       | not started    |
| EV-5  | INFRA-1 + AGENT-5                   | Alex eval blocking + tool parity    | P1  | -       | not started    |
| EV-6  | INFRA-3(Mira) + AGENT-8 + AGENT-9   | Mira real-generation eval           | P1  | -       | merged #1343   |
| EV-7  | AGENT-7 + INFRA-3(Robin) + AGENT-10 | Riley LLM-judgment + Robin lane     | P1  | -       | not started    |
| EV-8  | AGENT-1..4, AGENT-6                 | Alex missing-scenario fixtures      | P1  | -       | not started    |
| EV-9a | GOV-1, GOV-6                        | consent fail-closed branches        | P1  | yes     | not started    |
| EV-9b | GOV-3, GOV-4, GOV-5, GOV-7, GOV-8   | approval + operator-binding iso     | P1  | yes     | not started    |
| EV-10 | SPINE-3 (BUG-3), SPINE-4            | skill-runtime constraints / inert   | P1  | -       | not started    |
| EV-11 | MONEY-1, 3, 8, 9, 10                | pre-real-money-flip gate            | P1  | yes     | not started    |
| EV-12 | MONEY-4 (BUG-10), MONEY-5, MONEY-6  | attribution chain                   | P1  | yes     | not started    |
| EV-13 | MONEY-7 (BUG-8)                     | creative medical-claim judge        | P1  | yes     | not started    |
| EV-14 | CHAN-1, 2, 3, 7, 8                  | cross-tenant route sweep            | P1  | yes     | not started    |
| EV-15 | CHAN-4..6, 9, 10 (BUG-4, BUG-5)     | channel delivery fixes + evals      | P2  | -       | not started    |
| EV-16 | INFRA-2 + SPINE-6                   | real-Postgres integration tier      | P1  | -       | merged #1305   |
| EV-17 | SPINE-7..12 (BUG-6, BUG-7, BUG-11)  | spine async-correctness             | P2  | -       | not started    |
| EV-18 | APP-1, APP-2, APP-3                 | dashboard/app state evals           | P2  | -       | not started    |
| EV-19 | INFRA-4, INFRA-5, GOV-9, GOV-10     | eval-infra housekeeping             | P3  | -       | not started    |

**Recommended order:** EV-2 (the one still-open P0/P1 correctness gap - the stranded-claim
dead-letter) -> EV-16 (CI job over the existing `DATABASE_URL` PG tier; unblocks EV-1 + the real-PG
evals) -> EV-1 (regression guard over the merged #1269 fix) -> EV-3 -> EV-4 (zero adversarial
coverage) -> EV-5 -> EV-6 (un-park + extend agent evals) -> EV-11 -> EV-12 -> EV-13 (the pre-flip
money gate) -> EV-9a -> EV-9b -> EV-14 (consent + tenant) -> EV-7, EV-8, EV-10, EV-15, EV-17, EV-18,
EV-19.

**Coordination:** **BUG-1/A7b is already merged (#1269)** - EV-1 is now a regression eval over that
fix, no coordination needed, and there is no open `fix/proof-chain-integrity-a7` worktree. EV-2 is
the **A8b** stalled-pending reaper item; re-check `gh pr list` + `git worktree list` before starting
(the Robin-recovery send store has a sibling not-yet-built reaper noted in
`robin-recovery-send-core.ts`). **A19/GOV-2 has since merged (#1278)** and is dropped from EV-9a.

---

## EV-1 - `Booking.workTraceId` join regression eval (SPINE-1) [P2, depends on EV-16]

**The fix already merged (#1269 `a102b1ef0`).** This slice does NOT re-do it - it adds the missing
regression guard so the seam can never silently re-break. The bug was: producer
`packages/core/src/skill-runtime/tools/calendar-book.ts:371` writes `workTraceId: ctx.workUnitId`,
but the consumer joined against `WorkTrace.id` (cuid PK), nulling the proof-chain. #1269 corrected
the join to `workUnitId` (`@unique`) and the stored value already equalled it, so **no backfill was
needed**.

- **Files (read-only refs, already correct):** `prisma-receipted-booking-store.ts:140-141` (joins on
  `workUnitId`); `packages/core/src/channel-gateway/channel-gateway.ts:153` (records
  `response.result.workUnitId` into `ConversationEndEvent.workTraceIds`). New test under the EV-16 PG
  tier.
- **Approach:** add a **real-Postgres** regression eval that seeds a `WorkTrace` with distinct
  `id`/`workUnitId`/`traceId` and a `Booking` with `workTraceId = workUnitId`, then asserts the
  receipted-booking view surfaces non-null `traceId`/`matchedPolicies`/`approvalId` and strong
  attribution resolves. Mocked Prisma cannot catch this (it returns forced rows regardless of the
  WHERE column), which is exactly why the original bug shipped - so this MUST be a `DATABASE_URL`-gated
  test, not a mock.
- **Acceptance:** the eval is green on `main` (the fix is in) and would go red if either join axis
  regresses to `id`. Depends on EV-16 for the CI job. No behavior change, no SURFACE.

## EV-2 - At-most-once delivery safety: stranded-claim dead-letter + pre-send ordering (SPINE-2 / BUG-2 + SPINE-5) [P1, SURFACE]

A crash between `claim()` and `finalizeTrace` permanently blocks an idempotency key. The permanent
block is **deliberate** (`platform-ingress.ts:120-142`: the mutation may have committed, so fail
closed - Doctrine #6). The gap is the missing dead-letter + operator visibility, NOT the lack of a
resubmit. **Getting this wrong is a double-apply hazard on bookings/budgets/payments.**

- **Files:** `packages/core/src/platform/platform-ingress.ts` (the `:120-142` replay guard, which
  today special-cases only `outcome === "running"`); `packages/core/src/platform/types.ts` (the
  closed `WorkOutcome` union); `packages/core/src/platform/work-trace-lock.ts`
  (`TERMINAL_OUTCOMES` + `ALLOWED_OUTCOME_TRANSITIONS["running"]`);
  `packages/db/.../prisma-work-trace-store.ts` (a bounded `findStuckRunning(olderThan)`); cron wiring
  in `apps/api/src/bootstrap`; SPINE-5: `packages/db/.../prisma-robin-recovery-send-store.ts` +
  `apps/api/src/bootstrap/robin-recovery-send-core.ts`.
- **Approach (SPINE-2):** a bounded reaper ages orphaned `running` claims older than N minutes to a
  **non-resubmittable** terminal sink, emitting a counter + operator alert. **The terminal value is
  not free:** `WorkOutcome` is a closed union (`types.ts:10` = completed|failed|pending_approval|queued|running)
  and `ALLOWED_OUTCOME_TRANSITIONS["running"]` (`work-trace-lock.ts:16`) does NOT include a recon
  state, so a reaper write of an unlisted outcome is rejected by `validateUpdate`. Choose one: (a)
  add `needs_reconciliation` to the `WorkOutcome` union, to `ALLOWED_OUTCOME_TRANSITIONS["running"]`,
  to `TERMINAL_OUTCOMES`, plus a `needs_reconciliation: new Set([])` entry - the principled option,
  and **then extend the `:130` replay guard to special-case it** so a replay keeps returning the
  non-retryable reconciliation signal (NOT a clean cached result); or (b) reuse the existing terminal
  `failed` (no type/transition change) - lower effort, but a replay then returns the cached `failed`
  result and **loses the "may-have-committed / reconcile" distinction** unless a sub-flag carries it.
  Prefer (a). Either way the key must NEVER become re-runnable (no second idempotency line of
  defense exists). Write the eval first to document today's silent-block, then assert the reaper
  produces the dead-letter + alert and that a replay is still rejected.
- **Approach (SPINE-5):** pin the send-store ordering - the claim / `nextRetryAt`-clear precedes the
  network send, so a post-send write failure leaves the row not-due (stranded-sent, never
  double-sent). Assert the ordering and the post-send-failure-not-re-due path.
- **Acceptance:** a stranded `running` row is aged to `needs_reconciliation` with a counter + alert
  and **a resubmit of its key is still rejected** (NOT executed); the send-store claim demonstrably
  precedes the network call. SURFACE.

## EV-3 - Injection + input-robustness eval suite (ADV-1 + ADV-3) [P1]

Zero injection or malformed-input coverage exists for any LLM agent today.

- **Files:** new `evals/adversarial-injection/` (corpus + runner shared across agents); reuse the
  Alex/Mira builders and Riley prompt surface.
- **Approach:** ADV-1 - one corpus of attacker-influenceable strings (ignore-previous-instructions,
  reveal-system-prompt, set-price/deposit/budget-to-X, role-swap "pretend you're the doctor / the
  operator") injected via the real untrusted channels: Alex inbound message, Riley campaign/ad
  names, Mira operator-taste and business-facts text. Assert: instruction ignored, no
  price/deposit/budget change, no prompt leak, output stays schema-valid. ADV-3 - malformed inputs
  (empty, 10k emoji, mixed-script, script-ish payloads) degrade gracefully: no crash, no tool-arg
  injection.
- **Acceptance:** each agent passes both corpora; a deliberately weakened prompt fails the injection
  set (the eval has teeth). Live-model legs gated per the build-loop protocol (the `evals/` runtime
  branch, not a `skipIf + EVAL=1` combo).
- **Shipped (#1323):** `evals/adversarial-injection/` - the shared corpus (all three seams, full
  ADV-1 + ADV-3 taxonomy) + an **agent-agnostic deterministic grader** (BLOCKING, no key:
  unexpected-tool, tool-arg injection, forbidden-response-substring, prompt-leak canary,
  schema-invalid, crash) + an offline injected-executor teeth test that drives the **real**
  `runConversation` (proves teeth with no key) + an informational live judge gated via idiom (a).
  **Scope cut:** Alex is the only agent with a live LLM harness today (Riley's eval is model-free;
  Mira has none), so **Alex is driven live now**; the Riley/Mira corpus cases are graded
  deterministically via synthetic outputs (the two `reveal-system-prompt` cases are explicitly
  parked pending each seam's leak canaries - a corpus test stops that parked set growing silently).
  Their **live** legs are **EV-3b** (Riley, rides with EV-7) and **EV-3c** (Mira, rides with EV-6),
  which consume this corpus + grader. New path-filtered CI job mirrors `eval-alex-conversation`
  (unit tests blocking, live leg key-gated). Non-SURFACE: no live agent was probed (no key), so no
  vulnerability was found; a live deterministic violation hard-fails and SURFACEs.

## EV-4 - Claim-boundary suite, classifier ON and OFF (ADV-2) [P1]

The claim classifier is inert in prod (`mode:"off"`, no governanceConfig seeded), so the prompt is
the only live defense - which makes this high-stakes for the medspa vertical.

- **Files:** extend `evals/alex-conversation/` and the new Mira harness (EV-6); reuse the classifier
  `claimType` enum (`efficacy/safety/superiority/urgency/testimonial/medical-advice/diagnosis/credentials`)
  as the adversarial taxonomy.
- **Approach:** run claim-bait scenarios in two modes - (a) classifier off (today's prod reality):
  the prompt alone must refuse/hedge/escalate; (b) classifier enforce: the gate rewrites/escalates.
- **Acceptance:** both modes pass; the enum is fully covered; a guarantee-bait gets no efficacy/
  safety claim in either mode.

## EV-5 - Make Alex's LLM eval blocking + tool-schema parity (INFRA-1 + AGENT-5) [P1]

Two coupled fixes to the highest-coverage agent eval.

- **Files:** `.github/workflows/ci.yml` (Alex eval job); Actions secret `ANTHROPIC_API_KEY`;
  `evals/alex-conversation/mock-tools.ts` + `mock-tools.test.ts`; export the real tool defs from
  `packages/core/src/skill-runtime/tools/*` (e.g. `calendar-book.ts` builds schemas inline today).
- **Approach:** (INFRA-1) restore a working `ANTHROPIC_API_KEY` Actions secret FIRST - this is a hard
  precondition; only then un-park the baseline bake and flip the live leg by deleting its single
  `continue-on-error: true` (the script already `exit(1)`s on regression). (AGENT-5) export each real
  tool's `inputSchema`/`required`/enums as a constant and assert the eval mock equals the real def by
  import, not against frozen literals (the "mock-tool-blind" fix; confirmed live drift - the mock's
  `booking.create` `required` includes `contactId` while the real tool omits it as trusted context).
- **Acceptance:** with the key restored, a real tool-contract change fails the eval and the Alex live
  leg gates merges. Do NOT flip to blocking until the key is confirmed working (else every PR red).

## EV-6 - Mira real-generation eval harness (INFRA-3 Mira + AGENT-8 + AGENT-9) [P1]

Mira has zero real-generation eval; her propose/abstain judgment and claim-cleanliness are unverified.

- **Files:** new `evals/mira-self-brief/` (golden inputs: taste, measured performance, pipeline
  state -> graded brief/abstain); reuse `parseMiraComposeOutput` for the shape leg.
- **Approach:** golden scenarios graded by a judge for: abstain-on-thin-signal, abstain-on-loaded-
  desk, propose-grounded-in-frontline-demand, measured-over-taste-on-money, claim-boundary
  cleanliness, and no cross-agent contract bleed (run the output through the **real** downstream
  parser, not a fixture string).
- **Acceptance:** the harness scores Mira against a committed baseline; live legs gated per the
  build-loop protocol (the `evals/` runtime branch).
- **Shipped (#1343):** `evals/mira-self-brief/` — the deterministic BLOCKING grader (no key) runs the
  driven compose through the **real** `parseMiraComposeOutput` (shape) + the executor's `intentClass` /
  `qualificationSignals` strip side-channels (contract-bleed, AGENT-9) + sharp **lexical** banned-claim
  patterns from the SKILL.md claim boundaries (brief fields only). It drives Mira's REAL generation (the
  real SKILL.md body through a zero-tool/zero-hook `SkillExecutorImpl`); the offline whole-path teeth
  round-trip a bled `<intent>` tag through the real executor. The informational live judge (propose/
  abstain quality + claim cleanliness) is gated via idiom (a); no `baseline.json` baked (no key). A
  builder-faithfulness test pins the golden param format to the real `miraBuilder`. Six golden scenarios
  (abstain-on-thin-signal, abstain-on-loaded-desk, propose-grounded-in-frontline-demand,
  measured-over-taste-on-money, claim-boundary-cleanliness, riley-handoff-no-contract-bleed). **EV-3c**
  (the Mira injection live lane) is now **unblocked** — it reuses this drive + the EV-3 corpus/grader.
- **Surfaced follow-up — empty-messages defect (F1, separate SURFACE-class PR):** building the harness
  found that the compose submit carries NO conversation, so `skill-mode` forwards `messages: []` to the
  executor -> `client.messages.create({ messages: [] })`, which a LIVE Anthropic call rejects (>=1
  message required). Masked only because `MIRA_SELF_BRIEF_ENABLED` is dark and compose has never run
  live (verified across BOTH compose entry points: weekly scan + Riley handoff) - exactly why AGENT-8's
  coverage was "none". The fix: the compose submit must carry a minimal user turn (the harness's
  `COMPOSE_USER_TURN` is the shape the fix should add). Kept out of the eval PR; tracked here.

## EV-7 - Riley LLM-judgment eval + Robin behavioral lane (AGENT-7 + INFRA-3 Robin + AGENT-10) [P1]

- **Files:** replace the canned-replay `eval-suite.test.ts` (`ao-*`) with a live-model lane in
  `evals/riley-recommendation/`; add a Robin lane covering the live window-gate end-to-end.
- **Approach:** Riley - run the `ao-*` scenarios against a live model and assert it chooses
  kill/scale/abstain correctly from raw data (today only plumbing is tested). Robin - exercise
  `getRecoverySendContext` producing `no_optin` via the real thread read, not an injected eligibility.
- **Acceptance:** Riley live lane gates judgment regressions; Robin's `no_optin` path is asserted
  end-to-end. Live legs gated per the build-loop protocol (the `evals/` runtime branch).

## EV-8 - Alex missing-scenario fixtures (AGENT-1..4, AGENT-6) [P1]

- **Files:** `evals/alex-conversation/fixtures/*.jsonl` + oracle.
- **Approach:** add fixtures for: `pending_approval` booking return (not over-claimed, no deposit/
  escalate), reschedule/cancel handled directly, deposit issued only after confirmed, out-of-area
  disqualification, refund-policy + branded-treatment grounding (escalate, never improvise), and a
  BM/Malay output-quality scenario.
- **Acceptance:** each new fixture is graded by the existing oracle + judge; baseline updated.

## EV-9a - Consent fail-closed branch evals (GOV-1, GOV-6) [P1, SURFACE]

**GOV-2 dropped - A19 merged as #1278** (a seam test composing the real
`createBookingConsentPrecondition` + `enforceConsentPrecondition`: resolver-error + warm enforce +
pending consent BLOCKS, granted ALLOWS, cold cache inert). That is exactly the GOV-2 assertion, so it
is covered; nothing to add.

- **Files:** `packages/core/src/channel-gateway/consent-revocation-gate.ts:31-55`; CTWA path in
  `lead-intake-handler.ts`.
- **Approach:** GOV-1 - pin the inbound revocation-gate fail-open on resolver error + its audit
  verdict, and force an explicit fail-open-vs-closed decision (a dropped STOP is PDPA exposure).
  GOV-6 - assert a CTWA inside-window allow writes no durable `messagingOptIn`,
  `messagingOptInSource:"ctwa"` alone fails the outside-window gate, and no-regreeting reuse holds.
- **Acceptance:** each branch has a red-without / green-with test. SURFACE.

## EV-9b - Approval + operator-binding isolation evals (GOV-3, GOV-4, GOV-5, GOV-7, GOV-8) [P1, SURFACE]

- **Files:** `packages/core/src/channel-gateway/operator-channel-binding-store.ts` (no test today);
  `approval/lifecycle-dispatch.ts:79-82`; `approval/router.ts:64-77`; the bypass-guard scope-hole
  doc in `platform/work-trace-bypass-guard.ts`; `deterministic-safety-gate.ts`.
- **Approach:** GOV-3 - org-B query never returns org-A binding; revoked binding never returned.
  GOV-4 - `writeApprovedPayloadToTrace` rejection leaves lifecycle approved-but-undispatched.
  GOV-5 - a `completed` seal is impossible without a `governanceOutcome==="execute"` claim.
  GOV-7 - empty-approvers + `denyWhenNoApprovers=false` cannot silently auto-pass.
  GOV-8 - banned-phrase block survives `handoffStore`/`conversationStore` throws.
- **Acceptance:** each is a new asserting test; GOV-3 is the cross-tenant WhatsApp-send guard. SURFACE.

## EV-10 - Skill-runtime constraints-drop + prod-inert matrix (SPINE-3 / BUG-3, SPINE-4) [P1]

- **Files:** `packages/core/src/platform/modes/skill-mode.ts:93`; the executor policy path;
  intent registry + `resolveMode`; PLATFORM_DIRECT carve-out.
- **Approach:** SPINE-3 - give SkillMode `constraints.maxToolCalls:1` with a default-policy
  executor and assert the executor allows more than 1, pinning the current drop so a future
  "wire constraints into policy" change is a deliberate, test-flagged event; assert
  `maxWritesPerExecution` does not bound writes. SPINE-4 - a consolidated all-or-inert matrix:
  unseeded `resolveMode` throws; an auto-execute cron-intent needs allow-gov + PLATFORM_DIRECT +
  handler + schedule trigger + seeded `system` actor, each negative producing its specific code.
- **Acceptance:** the constraints-drop is pinned and visible; the inert matrix covers all five legs.

## EV-11 - Pre-real-money-flip gate (MONEY-1, 3, 8, 9, 10) [P1, SURFACE]

The must-pass set before `RILEY_*_SELF_EXECUTION_ENABLED` flips. **MONEY-2 is dropped - already
covered** (`campaign-decision.test.ts:75,199` assert the `measurement_untrusted` hold).

- **Files:** `packages/ad-optimizer/src/{blast-radius-contract,campaign-decision,
analyzers/opportunity-arbitrator,analyzers/source-reallocation,meta-ads-client}.ts`;
  `apps/api/src/bootstrap/inngest.ts` (flag wiring).
- **Approach:** MONEY-1 - the **residual** gap only: the multi-cycle compounding sum across N audit
  cycles + multiple campaigns in one cycle (single-pass arbitration + primary-only is already covered
  by `opportunity-arbitrator.test.ts`). MONEY-3 - reallocation blocked below the 0.7 coverage floor.
  MONEY-8 - flag-default-OFF wiring (no submitter wired when unset; pause needs env AND per-org).
  MONEY-9 - fresh-client-per-call usage contract. MONEY-10 - direct sane-ceiling + NaN guards.
- **Acceptance:** the five form a named "pre-flip" eval group, all green before any flip. SURFACE.

## EV-12 - Attribution chain (MONEY-4 / BUG-10, MONEY-5, MONEY-6) [P1, SURFACE]

- **Files:** `packages/ad-optimizer/src/{meta-capi-dispatcher,meta-capi-client,ctwa-adapter}.ts`;
  the Contact -> Booking -> ConversionEvent path.
- **Approach:** MONEY-4 - assert `event_time` = conversion time end-to-end (Booking T -> event),
  and resolve the `meta-capi-client.ts:36` `Date.now()` `fbc` path vs the dispatcher's `occurredAt`.
  MONEY-5 - CTWA `ctwa_clid` preserved through contact folding; never mis-assigns campaign.
  MONEY-6 - `event_id` determinism on retry; decide whether an app-level sent-event ledger is
  required vs Meta's dedup window (document the decision).
- **Acceptance:** the full clid->booked chain has an end-to-end eval; the dedup decision is recorded. SURFACE.

## EV-13 - Creative medical-claim judge + `claimsPolicyTag` enforcement (MONEY-7 / BUG-8) [P1, SURFACE]

Biggest creative-side exposure for a regulated vertical.

- **Files:** `packages/creative-pipeline/src/ugc/{ugc-script-writer,realism-scorer,approval-config}.ts`.
- **Approach:** add an LLM-judge claim-safety rubric over generated scripts/hooks (banned /
  unsubstantiated medical claims, guaranteed results, "FDA-approved"); enforce the currently-unparsed
  `claimsPolicyTag`; add hallucinated-offer + forbidden-phrase enforcement post-generation.
- **Acceptance:** a script with a banned claim is blocked/routed to human; `claimsPolicyTag` is
  validated, not just captured. Live legs gated per the build-loop protocol. SURFACE.

## EV-14 - Cross-tenant route sweep + deferred-store isolation (CHAN-1, 2, 3, 7, 8) [P1, SURFACE]

- **Files:** the uncovered allowlisted routes (`knowledge`, `knowledge-entries`, `conversations`,
  `audit`, `policies`, `competence`, `token-usage`, `contacts`, `opportunities`, `automations`,
  `scheduled-reports`, `webhooks`-registry); `store-mutation-check.ts`; `runtime-registry.ts`;
  `session-token`, `get-api-client.ts`; cross-channel STOP path.
- **Approach:** CHAN-1 - per-route "org A cannot read/mutate org B" tests (mirror
  `cross-tenant-isolation.test.ts`). CHAN-2 - data-layer isolation tests for the
  `store-mutation-deferred`-suppressed stores (the CI gate is advisory only). CHAN-3 - a 2-org
  registry routes each webhook to the correct org. CHAN-7 - session-token / dashboard API-client
  org binding. CHAN-8 - cross-channel STOP is org+contact-scoped.
- **Acceptance:** every uncovered tenant-private route has an isolation test; the deferred stores
  carry orgId in WHERE under test. SURFACE.

## EV-15 - Channel delivery fixes + evals (CHAN-4..6, 9, 10 / BUG-4, BUG-5) [P2]

- **Files:** `apps/chat/src/adapters/{telegram.ts:220,instagram.ts:118}`; WhatsApp status path;
  approval-card formatters; webhook robustness.
- **Approach:** CHAN-4 - cap/encode Telegram `callback_data` to <=64 bytes + eval. CHAN-5 -
  timing-safe IG `verify_token` + parity eval. CHAN-6 - dedup duplicate WhatsApp status callbacks.
  CHAN-9 - WhatsApp <=3 buttons / 20-char titles, IG <=3 quick-replies truncation. CHAN-10 -
  oversized/deeply-nested webhook bounded; Slack >5-min skew rejected; surface the silent
  flow-JSON-parse swallow.
- **Acceptance:** each fix has a red-without test; the two confirmed bugs (CHAN-4, CHAN-5) fixed.

## EV-16 - Real-Postgres integration eval CI job (INFRA-2) [P1]

Structural foundation: unlocks the evals mocked Prisma cannot reach. **A `DATABASE_URL`-gated tier
already exists** in `packages/db` (`describe.skipIf(!process.env.DATABASE_URL)`, e.g.
`prisma-work-trace-store-integrity.test.ts`) - this slice gives it a CI job, it does not invent a new
tier.

- **Files:** `.github/workflows/ci.yml` (a new integration job); reuse the **existing** `DATABASE_URL`
  skip-gate idiom (do NOT add `INTEGRATION_DB_URL`). There is **no** vitest workspace/projects
  mechanism in this repo - run it as a standalone `--config` invocation the way `evals/` and
  `apps/dashboard` already run, not as a "vitest project." The existing
  `platform-ingress-trace-atomicity.test.ts` is the discipline to copy (genuinely separate
  domain-write and trace transactions).
- **Approach:** the new job declares its **own** `services: postgres:` (GH Actions service containers
  are per-job and torn down at job end - the `setup` job's Postgres is NOT reusable downstream),
  migrates + seeds, sets `DATABASE_URL`, and runs the `describe.skipIf(!process.env.DATABASE_URL)`
  suites: referential integrity, true unique-constraint races (`(org, idempotencyKey)`, `dedupeKey`
  P2002), advisory-lock serialization, org-scope WHERE enforcement. Keep it a separate, opt-in job so
  the unit lanes stay Postgres-free.
- **Acceptance:** SPINE-1, SPINE-6, SPINE-8, CHAN-2 run under the job; it is green and isolated from
  the unit lanes; no `INTEGRATION_DB_URL` introduced.

## EV-17 - Spine async-correctness (SPINE-7..12 / BUG-6, BUG-7, BUG-11) [P2]

- **Files:** `mode-dispatcher.ts` (`dispatchedAt`); `prisma-creative-job-store.ts:388-425`
  (`listTasteCandidates` Leg-2); lifecycle-sweep registration in `bootstrap/inngest.ts`;
  `status-mapper.ts`/`build-read-model.ts` (dual-lifecycle); the `safeParse` seam sites.
- **Approach:** SPINE-7 - assert JSON-safe step payloads (ISO timestamps, no `undefined`). SPINE-8 -
  the Leg-2 starvation eval (real-PG). SPINE-11 - register `sweepExpiredLifecycles` + bound its
  query. SPINE-9 - UGC-complete-with-stale-`currentStage` reads terminal. SPINE-10 - replay to a
  terminal job is a no-op. SPINE-12 - malformed stored JSON -> typed default at each seam.
- **Acceptance:** each defect has a red-without test; the dual-lifecycle reader cannot misclassify.

## EV-18 - Dashboard / app state evals (APP-1, APP-2, APP-3) [P2]

- **Files:** `apps/dashboard/src/hooks/{use-agent-pipeline,use-decision-feed,use-mira-feed}.ts`;
  dashboard prod-env preflight; loading-state gating.
- **Approach:** APP-1 - loading/error/data + org-scoped-key tests for the untested core fetch hooks.
  APP-2 - a missing-`DATABASE_URL`/`CREDENTIALS_ENCRYPTION_KEY` preflight test + `DEV_BYPASS_AUTH`
  refused in prod. APP-3 - broaden the `!data && !error` loading-gate enforcement.
- **Acceptance:** the three Home/Inbox/Mira data hooks are covered; the prod preflight fails safely.

## EV-19 - Eval-infra housekeeping (INFRA-4, INFRA-5, GOV-9, GOV-10) [P3]

- **Files:** `.agent/evals/resolver-evals.json` (+ a runner); `apps/api`/`apps/chat`
  `vitest.config.ts`; the four numeric-safety guard sites; the idempotency replay-after-de-entitlement
  path.
- **Approach:** INFRA-4 - wire a runner for the resolver routing dataset. INFRA-5 - give api/chat
  their own coverage thresholds. GOV-9 - pin the intentional replay-after-de-entitlement behavior.
  GOV-10 - consolidate a NaN/Infinity-fails-toward-require-approval matrix across all four sites.
- **Acceptance:** resolver routing is measured; api/chat have floors; the numeric matrix is one suite.
