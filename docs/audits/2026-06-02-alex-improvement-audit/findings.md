# Alex Improvement Audit — Findings & Recommendations

**Date:** 2026-06-02
**Scope:** "What can we do to further improve Alex?" — a full, precision codebase audit.
**Branch / worktree:** `worktree-alex-improvement-audit` (off `main`)

> **Read order:** this is the raw audit synthesis. The "what we'll do" decision — after a critical review of this audit — lives in [`execution-plan.md`](./execution-plan.md), grounded by [`intent-coverage-matrix.md`](./intent-coverage-matrix.md). The "Tier 0 as one PR" framing in the recommendation below is **superseded** by the execution plan's PR-stack sequencing.

---

## How this was produced

A 10-lane parallel codebase audit run as a `find → adversarially-verify → critique` workflow:

- **10 independent audit lanes**, each reading the live `main` code and required to cite `file:line`, tie every finding to a real outcome (booking conversion / safety / cost-latency / reliability), and **de-duplicate against already-shipped, in-flight (PRs #794, #791, #782), and known-backlog work**.
- **Every high/medium finding then got an independent adversarial verifier** that re-opened the cited lines and tried to refute it (the "precision" backbone).
- A **completeness critic** surfaced cross-cutting themes, the single highest-leverage lever, and blind spots none of the lanes owned.

**Run stats:** 64 subagents · 3.2M tokens · 1,797 tool calls · ~21 min.
**Result:** 54 findings → **53 survived verification** (52 confirmed against `file:line`, 1 already-in-flight dropped, 1 low-impact unverified). **23 high-impact, 28 medium.**

> Full per-finding detail (current state, evidence, proposed change, risk, **plus each verifier's notes**) is in [`raw-findings-digest.md`](./raw-findings-digest.md). The source workflow JSON is [`raw-workflow-output.json`](./raw-workflow-output.json).

These are my synthesis and prioritization of that material. **Nothing here has been implemented** — this is the research input to a "what do we build next" decision.

---

## The headline (read this first)

Alex's *prompt content* is genuinely strong (voice, claim-boundaries, objection-handling, qualification framework — all live). The problem the audit surfaced is not the agent's "brain"; it's that **the machinery wrapped around the brain is largely built-but-unwired, and the green test suite structurally cannot see the gaps.** Two systemic truths and one bet:

### Systemic truth #1 — Alex's advertised safety / learning / grounding nets are built, tested, exported… and never run on the live path

The single most recurrent failure shape across all 10 lanes is **producer/consumer wiring gaps**: the two ends of a feature exist but never meet.

| What's "built" | Where it breaks |
|---|---|
| Operator BusinessFacts (hours/pricing/services) | Written to `AgentDeployment.inputConfig.businessFacts`, read from `BusinessConfig.config` — **two tables that never meet**. Alex launches **mute on its most common question type.** |
| A successful `booking.create` | Never advances the opportunity to `"booked"` (both `registerBookingCreateHook` callers are no-ops) — funnel/attribution depend on the LLM issuing a second tool call the prompt never asks for |
| Score-based trust ramp | `trustScore` never incremented on live approvals **and** never read for tool admission — autonomy is a static binary |
| Conservative launch posture | Onboarding writes `governanceSettings.startingAutonomy`; runtime only reads `trustLevelOverride` — the posture is silently dropped, new clinics run at `guided` |
| `ModelRouter`, `CircuitBreakerHook`, `BlastRadiusHook`, `ContactMutex`, `TracePersistenceHook` | All implemented + tested + exported, **all absent from the live hook/executor wiring** |
| `pilotMode` pattern-injection escape hatch | Wired but set by **zero deployments** → learned patterns ~never reach the prompt at pilot scale |
| `WorkTrace.injectedPatternIds` | Written at finalize, **read by nothing** → zero proof of learning lift |

### Systemic truth #2 — the green eval gives false confidence *precisely at the live seams*

Every lane found a defect CI structurally cannot see, because the eval harness diverges from production at exactly the load-bearing seams:

- It **bypasses `resolvePersona`** (`run-conversation.ts:174` casts the persona straight into the builder) → the persona-shape crash is invisible.
- It runs with **`router=undefined`** (Sonnet-everywhere) → the tier-downgrade is invisible.
- It runs **ungoverned (`[]` hooks)** → every deterministic gate/hook is invisible.
- It runs with **patterns empty** and the e2e context test **deliberately filters out business-facts** → the grounding gaps are invisible.
- The **judge itself is non-deterministic** (no `temperature:0`, unlike Alex which is meticulously pinned) and **context-blind** (grades a reply against a one-line synopsis, never the conversation) → the regression gate is intrinsically flaky, which is the *real* reason baseline-lock is stuck on `continue-on-error`, more than the credits the backlog blames.

### The one bet (highest-leverage, ship-now bundle)

If we do nothing else, do this three-part bundle — it's simultaneously the **highest booking-conversion impact, lowest effort, highest novelty, and most launch-blocking**, with no Meta/credit/new-route dependency:

1. **Unify the BusinessFacts producer/consumer + seed a real medspa facts blob.** The factual-question class ("how much is Botox", "what are your hours", "do you have parking") is the **highest-frequency inbound** and is currently escalated **100%** because the operator's diligently-filled facts land in a table Alex never reads. Today Alex launches functionally mute on its most common turn.
2. **Inject a current-date anchor into the prompt.** Alex is told to compute the slots-query window from "today" but the current date is never injected — it hallucinates the window → empty availability → false "having trouble checking availability" escalation at the exact moment of highest buying intent.
3. **`SlotQuerySchema.parse()` at the tool boundary** so `bufferMinutes` defaults. Today `(duration + undefined) = NaN` collapses availability to **~1 slot/day** on every booking attempt, on both providers — Alex physically cannot offer the "3-5 options" the script asks for.

All three are **pure wiring/one-liners**, each is **invisible to the green eval**, and together they convert the single largest class of avoidable escalations into instant correct answers and let a ready-to-book lead actually see real slots.

---

## The 5 cross-cutting themes (from the completeness critic)

1. **Producer/consumer wiring gaps dominate** — the machinery is built but the two ends never meet (see truth #1). Almost none of Alex's advertised safety/learning/grounding nets actually run live.
2. **The eval & green-CI give false confidence precisely at the live seams** (see truth #2).
3. **Over-escalation is the dominant conversion leak, compounding from multiple independent sources** — the system is biased to hand leads to humans at exactly the high-intent / high-frequency moments: empty facts → escalate every pricing/hours question; the slot collapse + missing date anchor + `guided` booking-park + no reschedule tool leak the booking close; the pre-input gate over-escalates bare "anxious" / un-negated condition keywords (the exact "aesthetic anxiety" lead Alex was *built* to win); the claim classifier has no confidence floor; and **every resulting handoff is blind** (assembler fed `messages:[]`). **Narrowing escalation + grounding answers is a larger conversion lever than any single new feature.**
4. **Dead/misleading code & stale comments create a safety illusion** — `canonical-merge cron` comment with no function; `TracePersistenceHook` "as if registered" comment; conversation-pattern + market reference files committed as "Phase 1a placeholder" stubs with no loader; `idempotent:true`/`maxWritesPerExecution` flags declared but never read; `emotional-classifier` exported with zero live importers; `bookingLink` resolved but never referenced in the prompt; `computeRetrievalConfidence` exported with no caller. A maintainer debugging "why doesn't X work" is actively misled.
5. **Cost/latency is spent on the hot reply path for zero benefit, and is unmeasurable** — every turn pays a Voyage embedding + pgvector + summary query whose results the builder discards; live Alex sends **no temperature** (samples ~1.0); the per-call timeout is dead and in-flight calls are never aborted (paid-for retries leak under a 10-min SDK default); and `TracePersistenceHook` isn't wired, so there's **no per-conversation token/latency/cache telemetry** to validate the router flip or caching against real traffic.

---

## Prioritized findings

Impact/effort are post-verification. `S/M/L` = small/medium/large. "CI-blind" = the current green suite cannot catch it.

### Tier 0 — Launch-blocking correctness bugs (looks-shipped, actually broken; cheap; mostly CI-blind)

These are **bugs, not features**. Each degrades or breaks Alex the moment a real lead arrives. Highest ROI on the board.

| # | Finding | Evidence (file:line) | Impact / Effort |
|---|---|---|---|
| T0.1 | **Operator BusinessFacts never reach Alex** — written to `inputConfig.businessFacts`, read from `BusinessConfig.config`; the read table has no seed/API/UI writer, so fresh orgs always start empty → escalate every hours/pricing/services question | `apps/dashboard/src/lib/api-client/marketplace.ts:83` (writer) vs `builders/alex.ts:97`, `prisma-business-facts-store.ts:7` (reader) | **High / S–M** |
| T0.2 | **`bufferMinutes=undefined` → NaN collapses availability to ~1 slot/day** — tool casts `params as SlotQuery` without `.parse()`, so the Zod `.default(15)` never applies; `(duration + undefined)*60_000 = NaN` exits the slot loop after one slot/day, on both providers | `calendar-book.ts:135`; `schemas/src/calendar.ts:9`; `calendar/slot-generator.ts:55` | **High / S** |
| T0.3 | **No current-date anchor in the prompt** — Alex told to query slots from "today" but no date is injected; it hallucinates the window → empty/ wrong availability → false "trouble checking availability" escalation at peak intent | `SKILL.md:201`; `calendar-book.ts:132`; `builders/alex.ts:125`; `skill-executor.ts:173` | **High / S** |
| T0.4 | **Failed SkillMode turns send the raw internal error string to the lead** — budget/turn/runtime/adapter throws return `ok:true` with `summary = err.message`; "Exceeded maximum LLM turns (6)" is sent to the customer **and** written into history (poisons the next turn). Graceful fallback is only reachable on `ok:false`, which SkillMode never produces | `skill-mode.ts:107`; `platform-ingress.ts:427`; `channel-gateway.ts:64,109` | **High / S** |
| T0.5 | **Persona criteria silently dropped (or crash interpolation), and the eval can't see it** — `resolvePersona` keeps qual/disqual/escalation criteria only when arrays; the seeded deployment supplies **objects** → fields become `undefined` → template engine throws → every live turn is `EXECUTION_ERROR`. The eval bypasses `resolvePersona`, so the 72-scenario baseline stays green | `prisma-deployment-resolver.ts:133`; `agent-persona-config.ts:47`; `seed-marketplace.ts:644`; `template-engine.ts:47`; `run-conversation.ts:174` | **High / M** |
| T0.6 | **`booking.create` never advances the opportunity to `"booked"`** — relies on an LLM `stage.update` the prompt never requests; deterministic lifecycle producer is a no-op → real bookings undercounted in funnel/attribution and re-engageable as "open" | `calendar-book.ts:142-326`; `SKILL.md:197-237`; `app.ts:705` / `inngest.ts:655` (no-op hooks) | **High / S** |
| T0.7 | **Live Alex sends no `temperature`** — router is OFF so no profile is set; the adapter omits the field → API default ~1.0 for a compliance-sensitive sales agent (more off-script/unsubstantiated-claim risk, noisier eval baseline) | `anthropic-tool-adapter.ts:149`; `skill-executor.ts:160`; `skill-mode.ts:547` | **High / S** |
| T0.8 | **A failed booking row permanently blocks re-booking the same slot** — the idempotency unique index includes `failed` rows, so a failed-then-retried same-slot booking dies on P2002 | `schema.prisma:1924`; `calendar-book.ts` failure path | Medium / S |

### Tier 1 — Conversion & safety levers (high value; several are genuine product decisions)

| # | Finding | Evidence | Impact / Effort |
|---|---|---|---|
| T1.1 | **Claim-classifier applies no confidence floor** — confidence is recorded for audit but never gates a decision; flipping `off→enforce` (a scheduled ops change) will rewrite/escalate a large fraction of normal turns on day one. Root cause of over-flag #673, both directions. Add `confidenceThreshold` (default ~0.7) | `claim-classifier.ts:192,196,198`; `governance-config.ts:37` | **High / M** |
| T1.2 | **Over-escalation narrowing** (cluster): pre-input gate escalates bare "anxious"/"anxiety" (collides with Alex's designed "aesthetic anxiety" objection); `sensitive_keyword`/`multi_treatment_combo` have **no negation guard** ("I'm NOT diabetic", "my mum had cancer" over-escalate); substantiation matching is **verbatim-substring only** so any paraphrased approved claim fails to match → escalates | `escalation-triggers/common.ts`; `substantiation-resolver.ts:62,89` | **High / S–M** |
| T1.3 | **No reschedule/cancel tool** — every appointment change is force-escalated, though `CalendarProvider.cancelBooking`/`rescheduleBooking` are fully implemented on both providers and `Booking` already has `rescheduleCount`. Reschedules are show-rate gold. Needs one new tool op + one `BookingStore.findUpcomingByContact` method | `calendar-book.ts:118-142`; `calendar.ts:95`; `google-calendar-adapter.ts:110` | **High / M** |
| T1.4 | **Every human handoff is blind** — `escalate` calls the rich `HandoffPackageAssembler` with `messages:[]`, so a `negative_sentiment` handoff arrives tagged `sentiment:neutral` with a generic opener; the human inherits zero context on the highest-value leads. Thread the real transcript/sidecar through | `escalate.ts:65`; `package-assembler.ts:43` | **High / M** |
| T1.5 | **Self-disclosed minor age not flagged** — minor trigger only matches third-party phrasing ("my daughter", "under 18"); "I'm 16, can I get fillers?" bypasses the gate entirely (a bright-line SG/MY consent risk). 4-char regex fix | `escalation-triggers/common.ts:50` | **High / S** |
| T1.6 | **Booking parks for human approval at the default posture** — `booking.create` is `external_mutation`; at `guided` (the live default) it returns `pending_approval`, but the SKILL script says "You're all set!" with no branch for the parked case → dead air or a false confirmation. Add a booking-scoped auto-approve dial **and** branch the confirmation prose on the tool result | `calendar-book.ts:145`; `governance.ts:29`; `SKILL.md:219` | **High / S** |
| T1.7 | **Score-based trust ramp is doubly dead** — `trustScore` never incremented by live approvals (`recordTrustEvent` gated on a `listing:` principal Alex never sets) **and** never read for admission (gate hardcodes `guided`). Either wire it end-to-end or delete the dead ledger (same class as the known spend-threshold illusion, but the core autonomy axis) | `governance-gate.ts:91`; `prisma-deployment-resolver.ts:131`; `platform-lifecycle.ts:579`; `app.ts:349` | **High / M** |
| T1.8 | **Conservative launch posture silently dropped** — onboarding writes `startingAutonomy`; runtime reads `trustLevelOverride` → onboarded clinics run `guided` (writes auto-approve) instead of the intended `supervised`. Distinct from the known `spendApprovalThreshold` gap | `onboard.ts:105`; `policy-overrides-config.ts:79`; `governance-gate.ts:91` | **High / S** |

### Tier 2 — Reliability & cost backstops (mostly wiring already-built machinery)

| # | Finding | Evidence | Impact / Effort |
|---|---|---|---|
| T2.1 | **CircuitBreaker + BlastRadius hooks never run live** — implemented/tested/exported but absent from the live hook array; `SkillRuntimePolicyResolver` is dead code; `maxWritesPerExecution` never read → no per-deployment write ceiling or failure circuit-breaker for autonomous Alex | `skill-mode.ts:540,550`; `skill-runtime-policy-resolver.ts:20`; `skill-executor.ts:307` | **High / M** |
| T2.2 | **Burst-message races + replay-guard bypass** — `ContactMutex`/`LoopDetector` built but never wired; the gateway omits `idempotencyKey`, so the D1 claim-first double-spend guard (#780) is **skipped for 100% of chat traffic** | `channel-gateway/concurrency.ts`; `channel-gateway.ts:288`; `platform-ingress.ts:514` | Medium–High / M |
| T2.3 | **30s whole-conversation budget too tight + timeout never aborts the in-flight call** — a legitimate multi-tool booking on Sonnet can exceed 30s (and the SDK silently retries); the `Promise.race` timeout leaks the underlying `messages.create` (full token burn for a reply nobody reads); `profile.timeoutMs` is plumbed but never passed | `types.ts:309`; `skill-executor.ts:216`; `anthropic-tool-adapter.ts:114`; `skill-mode.ts:341` | **High / M** |
| T2.4 | **Truncated reply returned as if complete** — `max_tokens` is handled identically to `end_turn`; a 1024-token cap mid-sentence is sent to the lead with no continuation | `skill-executor.ts:260` | Medium / S |
| T2.5 | **Provider `stop_reason`s (`pause_turn`/`refusal`) throw and kill the turn** instead of being handled/retried | `anthropic-tool-adapter.ts:175` | Medium / S |
| T2.6 | **No per-conversation cost/latency telemetry** — `TracePersistenceHook` unwired (and `skill-executor` never calls `runAfterSkillHooks`); adapter drops `cache_read`/`cache_creation` tokens → cache hit-rate unmeasurable, 64k budget overcounts cached tokens. **This is the prerequisite to validate the router flip and lock the baseline against real traffic** | `skill-mode.ts:344,540`; `trace-persistence-hook.ts:43`; `llm-types.ts:39` | **High / M** |
| T2.7 | **Booking double-book on the Google path** — the `SLOT_CONFLICT` guard exists only for the Local provider; `PrismaBookingStore.create` + `GoogleCalendarAdapter` have no overlap/freebusy check, so two parallel leads can confirm the same physical slot | `prisma-booking-store.ts:23`; `google-calendar-adapter.ts:74`; `calendar-provider-factory.ts:176` | **High / M** |
| T2.8 | **`crm-write.stage.update` re-leaks the full opportunity row** (contactId, financials, notes) into model context, defeating the `pii.ts` allow-list everywhere else | `crm-write.ts:67`; `prisma-opportunity-store.ts:348` | Medium / S |
| T2.9 | **Router tier keyed on the wrong counter** — `resolveTier` keys cheap-vs-strong model on the intra-invocation LLM-loop counter, not conversation depth, so flipping the router ON routes nearly every real sales reply to Haiku, and the eval (router OFF) is blind to it. **Re-key on conversation depth + add a router-ON eval variant before the flag flip** | `skill-executor.ts:149`; `skill-tier-context-builder.ts:26`; `model-router.ts:101` | Medium–High / M |

### Tier 3 — Learning-loop closure & measurement (the compounding engine)

| # | Finding | Evidence | Impact / Effort |
|---|---|---|---|
| T3.1 | **Pattern extraction only fires on a 30-min in-memory inactivity timer** — bookings never trigger it; a chat restart/deploy drops every in-flight (incl. booked) conversation before it's learned. The loop preferentially loses its most valuable signal. Trigger on the booking signal + make session-end durable | `gateway-bridge.ts:117`; `conversation-lifecycle.ts:53,96,107` | **High / M** |
| T3.2 | **Learned patterns ~never inject at pilot scale** — default surfacing bar `sourceCount>=3`; the `pilotMode` relaxation is wired but set by zero deployments | `context-builder.ts`; `builders/alex.ts:112` | Medium / S |
| T3.3 | **Decay keys on last *write*, not last *injection*** — high-confidence patterns actively driving conversations still decay; the "used" signal that would fix it is persisted and thrown away | memory decay cron; `injectedPatternIds` | Medium / S |
| T3.4 | **No consolidation/canonical-merge cron exists** despite a code comment claiming one → same-key patterns each strand below the surfacing bar permanently | `inngest.ts:4` (false comment) vs `:797` | Medium / M |
| T3.5 | **Per-pattern lift proof leg is fully open** — `injectedPatternIds` written, read by nothing; the eval that could measure lift runs patterns-empty + ungoverned | `work-trace` finalize; eval harness | Medium / M |
| T3.6 | **LLM judge is non-deterministic** (no `temperature:0`) → regression gate is intrinsically flaky; **this, not just credits, is why baseline-lock is stuck on `continue-on-error`.** ~2-line fix + re-capture baseline | `judge.ts:212,142`; `score.ts:95` | **High / S** |
| T3.7 | **Judge never sees the conversation** — grades a reply against a one-line synopsis, so "books before qualified" and "exactly one question / price-ack if applicable" are unverifiable → false passes on the most important conversion rule | `run-eval.ts:265`; `judge.ts:218,33,40` | **High / M** |
| T3.8 | **Zero online/production quality measurement** — Alex is measured live only by lagging booking counts; the judge never runs against a single real conversation | `metrics-alex.ts` | Medium / L |
| T3.9 | **Eval ↔ prod safety paths diverge silently** — 5 of 6 "must-escalate" red-flag eval scenarios are NOT covered by the production deterministic pre-input scanner, with no alignment test | eval fixtures vs `pre-input-gate.ts` | Medium / S |

### Tier 4 — Strategic gaps / blind spots (dimensions none of the 10 lanes owned)

These are the audit's own meta-findings — bigger, fuzzier, and worth a roadmap conversation rather than a one-line fix:

1. **Onboarding-to-first-live-conversation & operator preview** — there is **no sandbox/test-drive/dry-run** for an operator to QA Alex against sample leads before going live, and the provisioning-readiness guard checks the skill pack but **not** that BusinessFacts are non-empty or that the persona shape is interpolation-safe. A clinic discovers the mute/crash behavior on a real paying lead.
2. **WhatsApp 24h-window × follow-up × re-engagement interaction** — the window is implemented, but the *interaction* between the fail-closed follow-up tool, the window, and the stalled-sweep re-engagement path was never traced end-to-end. Does the sweep attempt a free-form send the API rejects?
3. **Conversation-length / context-window economics** — `skill-mode.ts:58` reads `conversation.messages` with no visible windowing; long medspa chats replay the full transcript every turn, growing cost linearly and **invalidating prompt caching exactly on the longest (most expensive) conversations.**
4. **Channel-specific behavioral divergence** — does Alex's 3-5 slot offer fit a single WhatsApp 1024-char bubble? Does the sidecar/intent-tag survive WhatsApp formatting? Same prompt for async WhatsApp vs synchronous web chat?
5. **Observability / alerting on live Alex** — Sentry is bootstrapped, but **nothing pages a human** if Alex starts denying every lead (the fail-closed-on-identity-miss landmine), empty-facts-escalating 100%, or leaking raw errors. No SLO/alert on conversion-rate, escalation-rate, deny-rate, or first-response latency.
6. **A/B experimentation & cold-start** — **no experiment/variant/bucket framework exists**, so every prompt/router/temperature change ships globally and is judged by lagging counts. And there's no curated cold-start prompt/starter patterns for the first clinic with empty patterns + (today) empty facts — Alex is weakest exactly when a pilot forms its first impression.
7. **Medspa SG/MY regulatory content depth** — the four archetype playbooks are empty stubs, but more importantly nobody assessed whether `claim-boundaries.md` actually encodes HSA / Medicine Advertisements Board specifics vs generic "don't diagnose," nor pricing-quote norms / treatment vocabulary depth.
8. **Data-retention / erasure for a medical channel** — PII-at-the-boundary shipped, but transcripts and extracted patterns (which embed health context like "acne scars", "wants fillers") have no retention/decay-to-deletion or right-to-erasure path.

---

## Appendix: defects found *inside already-shipped code* (per lane)

For traceability — each lane was also asked to report concrete defects in shipped code (full text in the raw digest):

- **conversation-quality:** persona object/array shape mismatch (T0.5); conversation-pattern/market reference files are dead "Phase 1a placeholder" stubs with no loader. *(Confirmed clean: PR #794 correctly removes both false "hold a slot" availability claims.)*
- **booking-conversion:** `bufferMinutes` NaN (T0.2); failed-row blocks re-book (T0.8); Google double-book (T2.7); `booking.create` no stage advance (T0.6).
- **model-inference:** dead per-call timeout / leaked request; bare Anthropic client (10-min/2-retry defaults under a 30s wall); stale `TracePersistenceHook` comment; loop-counter tier conflation; truncation-as-complete.
- **safety-escalation:** `escalate` drops the LLM summary/sentiment (`messages:[]`); substantiation is verbatim-substring only; `emotional-classifier` exported but dead (zero live importers — no deterministic frustration backstop).
- **learning-memory:** false `canonical-merge cron` comment; `dispose()` clears timers without flushing pending (incl. booked) sessions.
- **tools-capabilities:** blind handoff (T1.4); `stage.update` PII re-leak (T2.8); `booking.create` can orphan a real calendar event when the confirm-tx fails after the provider succeeded; `idempotent:true` flag decorative.
- **governance-autonomy:** `startingAutonomy` key mismatch (T1.8); `SkillRuntimePolicyResolver` dead; `maxWritesPerExecution`/`writeApprovalRequired` inert; `BlastRadius`/`CircuitBreaker` hooks unwired; trust read-path only in the legacy orchestrator.
- **eval-measurement:** `conversion` and `qualifiedPct` computed from the identical formula (qualification never actually measured); judge `max_tokens:512` truncation live on `main` (the fix is in-flight on #791 but unmerged); misleading `no-violations` rubber-stamp label.
- **runtime-robustness:** D1 replay guard bypassed for all chat traffic (no `idempotencyKey`); `ContactMutex`/`LoopDetector` dead; adapter `timeoutMs` ignored; `CircuitBreaker`/`BlastRadius` only run in the (dead) batch path.
- **knowledge-grounding:** BusinessFacts two-table split (T0.1); per-turn embedding + pgvector + summary computed then discarded; `renderBusinessFacts` silently omits `advanceBookingDays`; unvalidated JSON cast can throw and fail a turn; `computeRetrievalConfidence` dead.

---

## What I recommend we do next

This is a decision point, not an implementation. My recommended sequencing:

- **Ship now (pre-launch hygiene): Tier 0 as one focused PR (or a tight 2-PR stack).** These are cheap, verified, mostly one-liners, CI-blind, and each leaks conversion or breaks a live turn. The "one bet" bundle (BusinessFacts unify + seed, current-date anchor, `bufferMinutes` parse) plus the raw-error-leak fix and the persona-resolver/eval alignment is the highest ROI on the entire board. **Critically, fix the eval↔prod divergences in the same work** (route the eval through `resolvePersona`; pin the judge to `temperature:0`) so these can't silently regress again.
- **Then the conversion+safety levers (Tier 1).** The claim-classifier confidence floor and the over-escalation narrowing should land **before** the planned `off→observe→enforce` classifier flip and the router flip — both ops changes are landmines without them.
- **Then reliability/measurement (Tiers 2-3)**, with `TracePersistenceHook` + cache-token telemetry first (it's the prerequisite to validate the router flip and lock the baseline against real traffic), followed by the learning-loop closure.
- **Tier 4** is a separate roadmap conversation (operator preview, observability/SLOs, A/B infra, retention).

Each chosen item should go through the normal pipeline: brainstorm → spec → plan → TDD → review, in its own worktree/PR.
