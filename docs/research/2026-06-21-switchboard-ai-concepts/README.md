# Switchboard AI, Data-Systems & Governance Concepts: A Self-Teaching Curriculum

Switchboard is a governed operating system for revenue actions: an AI platform where autonomous agents (Alex the medspa booking agent, Riley the ad-optimizer, Mira the analyst) can spend real ad budgets, message real customers, and book real appointments on a business owner's behalf. Because those actions touch money, regulated medical claims, and personal data under Singapore and Malaysia PDPA, the platform is built so that nothing the model proposes is trusted blindly. This document teaches every AI, data-systems, and governance concept the platform uses, organized under three pillars: **Data systems and partnership readiness** (how trust signals, provenance, consent, freshness, identity, and audit records are modeled and validated), **Human-in-the-loop governance for AI actions** (default-deny enforcement, approval lifecycles, and citation grounding for regulated claims), and **Agentic engineering across the stack** (the skill runtime, execution APIs, and the eval and review tooling that regression-proofs all of it). Every claim below is backed by `file:line` references into the repository, so you can read the curriculum and the source side by side.

## How to use this doc

This is a self-teaching curriculum, not a reference manual you skim. Read it top to bottom as a course. Each concept is taught the same way: the transferable engineering principle first, then the concrete Switchboard implementation with exact `file:line` references and short real code excerpts, then the runtime data flow (producer, enforcer, consumer), then the sharp edges and gotchas. Open the cited files as you go and confirm the claims yourself; the goal is genuine understanding of a codebase that was partly vibe-coded, so verifying against the real source is the point. When a section says "study next," follow that thread before moving on.

## Suggested learning path

Work through the concepts in this order. Foundations come first because every higher layer assumes them.

1. **Schema contracts and quality floors** (Pillar 1, "Schema contracts & quality floors"). Start here: everything else assumes the parse-don't-validate discipline and the idea that a typed, bounded trust signal gates whether learned knowledge can act. Learn how `confidence` and `sourceCount` are derived, validated, and floored.
2. **Provenance, source counting, attribution tiers and WorkTrace lineage** (Pillar 1, "Provenance..."). Now meet `WorkTrace`, the canonical immutable audit row, and the server-resolved lineage that links an action to a contact, a conversation, and a dollar. This is the data structure the rest of the platform revolves around.
3. **Auditability: hash-chained, content-addressed audit records** (Pillar 1, "Auditability..."). Go one level deeper into the integrity primitives: canonical JSON, SHA-256 content addressing, the advisory-locked append-only ledger, redaction, and tenant-scoped reads. This is why a `WorkTrace` can serve as evidence.
4. **Identity disambiguation: idempotency keys and duplicate-contact risk** (Pillar 1, "Identity disambiguation..."). With WorkTrace understood, learn the P2002 claim-first primitive that makes submission idempotent and how the platform detects when two rows are the same human.
5. **Freshness: decay windows, recency signals, TTL caches** (Pillar 1, "Freshness..."). Learn how data age is handled everywhere: confidence decay, freshness gates, and TTL caches, plus the recurring NaN-guard lesson for missing timestamps.
6. **Consent boundaries, PDPA and jurisdiction gating** (Pillar 1, "Consent boundaries..."). See how the off/observe/enforce staged switch and the consent matrix gate customer-facing actions. This introduces the three-mode rollout pattern you will see again in governance.
7. **Default-deny enforcement and the cross-cutting governance seam** (Pillar 2, "Default-deny enforcement..."). Now enter governance: walk one action through `GovernanceGate.evaluate`, the deterministic policy engine, the spend floor, and the three outcomes (execute / require_approval / deny). This is the single chokepoint every mutating action passes.
8. **Approval gates and the full approval lifecycle** (Pillar 2, "Approval gates..."). When the gate says "needs a human," the approval lifecycle takes over. Learn the durable state machine, binding-hash integrity, and the fail-toward-dispatch-or-recovery invariant.
9. **Citation grounding and regulated-claim classification** (Pillar 2, "Citation grounding..."). See the three-layer pipeline that stops Alex from asserting an unsubstantiated medical claim: the Haiku classifier, the substantiation resolver, and the off/observe/enforce hook.
10. **Agent and skill runtime, operator controls, execution APIs and persistence** (Pillar 3, "Agent/skill runtime..."). Assemble the full engine room: the manifest, the skill loader, the tool factories, the executor loop, ingress, and how approvals dispatch. This ties together everything from steps 1 to 9.
11. **Evaluation suites and automated design/route/contract review tooling** (Pillar 3, "Evaluation suites..."). Finish with how all the above is regression-proofed: golden-fixture evals, trajectory grading, contract tests, and the route-governance static analyzer. The unifying lesson is that every grader calls live production code.

## Concept to code index

A quick-reference map from concept to its strongest implementation locations.

| Concept                                      | Pillar                    | Primary file(s)                                                                       | One-line role                                                                        |
| -------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Confidence Score Schema (`[0,1]` contract)   | Data systems              | `packages/schemas/src/deployment-memory.ts:36,63`                                     | Zod `min(0).max(1)` parse-don't-validate trust bound at the LLM boundary             |
| computeConfidenceScore                       | Data systems              | `packages/schemas/src/deployment-memory.ts:79-82`                                     | Derives confidence deterministically from corroboration count (log curve, 0.5..0.95) |
| sourceCount                                  | Data systems              | `packages/db/src/stores/prisma-deployment-memory-store.ts:36`; `schema.prisma:777`    | Monotonic corroboration counter incremented atomically                               |
| SURFACING_THRESHOLD                          | Data systems              | `packages/schemas/src/deployment-memory.ts:85`; `context-builder.ts:135-138`          | Steady-state quality floor (count>=3, conf>=0.66) gating prompt injection            |
| Pilot Mode surfacing                         | Data systems              | `packages/core/src/memory/outcome-pattern-extractor.ts:32-72`                         | Graduated floors with booking-evidence escape hatch for thin cohorts                 |
| Pattern confidence decay                     | Data systems              | `prisma-deployment-memory-store.ts:116-135`; `inngest.ts:644-646`                     | Daily cron decrements stale memory confidence above a 0.3 floor                      |
| WorkTrace (canonical audit row)              | Data systems              | `packages/core/src/platform/work-trace.ts:6-109`; `work-trace-recorder.ts:66-122`     | Immutable record of one governed work-unit submission                                |
| Lineage chain-weld                           | Data systems              | `work-trace-hash.ts:23-29`; `work-trace.ts:72-75`                                     | Server-resolved contactId/conversationThreadId excluded from the hash                |
| WorkTrace content hash + integrity           | Data systems + Governance | `work-trace-hash.ts:74-98`; `work-trace-integrity.ts:47-78`                           | Versioned content addressing + audit-anchor cross-check, fail-closed on mismatch     |
| Attribution confidence tiers                 | Data systems              | `packages/core/src/receipts/score-attribution.ts:28-40`                               | Five-rung evidence ladder snapshotted at receipt issuance                            |
| Booking-backed outcome attribution           | Data systems              | `packages/core/src/memory/booking-attribution.ts:41-79`                               | Two-tier strong/fallback/none link from conversation to booking                      |
| Riley corroboration predicate                | Data systems              | `packages/core/src/recommendations/outcome-corroboration.ts:123-200`                  | NaN-guarded gates upgrading directional to corroborated, never causal                |
| Canonical JSON (RFC 8785)                    | Data systems              | `packages/core/src/audit/canonical-json.ts:6-23`                                      | Deterministic serialization foundation for all content addressing                    |
| Hash-chained audit ledger                    | Data systems              | `packages/core/src/audit/ledger.ts:160-182`; `canonical-hash.ts:34-70`                | Append-only tamper-evident log with chain verification                               |
| Atomic append (advisory lock)                | Data systems              | `packages/db/src/storage/prisma-ledger-storage.ts:46-106`                             | `pg_advisory_xact_lock` serializes read-tail-then-append                             |
| Snapshot redaction + masking                 | Data systems              | `packages/core/src/audit/redaction.ts:7-16`; `mask-email.ts`, `mask-phone.ts`         | Field-path + pattern scrub before hashing; masked fragments for logs                 |
| Org-scoped cursor browse                     | Data systems              | `packages/core/src/audit/list-entries.ts:112-165`; `prisma-ledger-storage.ts:148-185` | Keyset pagination with the load-bearing AND-wrapped cursor for tenant safety         |
| Credential encryption                        | Data systems              | `packages/db/src/crypto/credentials.ts:23-47`                                         | AES-256-GCM + per-record scrypt salt; DB dump yields ciphertext only                 |
| Org-scoped credential resolution             | Data systems              | `packages/db/src/storage/prisma-credential-resolver.ts:38-80`                         | Org connection first, explicit null-org global fallback only                         |
| P2002 claim-first idempotency                | Data systems              | `issue-receipted-booking.ts:5`; `prisma-work-trace-store.ts:147-158`                  | Unique-constraint-as-lock with report/read-back/no-op collision behaviors            |
| Orchestrator idempotency fingerprint         | Data systems              | `packages/core/src/idempotency/guard.ts:60-70`                                        | sha256 over sorted-key params, TTL-cached, protects governance compute               |
| phoneE164 normalization                      | Data systems              | `packages/db/src/stores/prisma-contact-store.ts:90`                                   | Canonical normalized identity column for duplicate detection                         |
| duplicate_contact_risk detection             | Data systems              | `issue-receipted-booking.ts:102-114`; `evaluate-exceptions.ts:44-46`                  | Detected once at issuance, carried as durable exception state                        |
| Append-only exception merge                  | Data systems              | `packages/core/src/receipts/merge-exceptions.ts:20-62`                                | Governed-code-scoped merge preserving human resolutions                              |
| Decay windows / TTL caches                   | Data systems              | `policy-cache.ts`; `propose-helpers.ts:89-195`; `guard.ts:23-54`                      | Read-timestamp, compute-age, compare-window primitive across hot paths               |
| Substantiation staleness window              | Data systems              | `substantiation-resolver.ts:14,116-120`                                               | Dual gate: per-claim validUntil OR 180-day reviewedAt window                         |
| OAuth state freshness                        | Data systems              | `packages/ad-optimizer/src/facebook-oauth.ts:30,58-85`                                | Signed, 10-minute replay window; signature verified before age check                 |
| Jurisdiction-scoped immutable consent        | Data systems              | `consent-service.ts:108`; `prisma-consent-store.ts:60`                                | Write-once PDPA jurisdiction at service + conditional-WHERE layers                   |
| Three-mode enforcement (off/observe/enforce) | Data systems / Governance | `packages/schemas/src/governance-config.ts:76,238`                                    | Staged rollout switch, fail-safe-to-off on corrupt config                            |
| Derived consent status + gate matrix         | Data systems              | `packages/schemas/src/pdpa-consent.ts:57,86`                                          | Pure derivation; operational vs proactive message-class gating                       |
| Consent egress + booking gates               | Data systems              | `consent-enforcement-gate.ts:33`; `calendar-book-consent.ts:93`                       | Fail-open egress backstop vs fail-closed booking precondition                        |
| GovernanceGate evaluation pipeline           | Governance                | `governance-gate.ts:143`; `platform-ingress.ts:259`                                   | The single policy enforcement point every action passes                              |
| Default-deny baseline                        | Governance                | `packages/core/src/engine/policy-engine.ts:588-589`                                   | Unmatched action coalesces to deny                                                   |
| Hard spend-limit floor                       | Governance                | `packages/core/src/engine/spend-limits.ts:37`                                         | Non-overridable cap checked before policy rules                                      |
| System auto-approved short-circuit + guards  | Governance                | `governance-gate.ts:165-193`                                                          | Fenced fast path with F4 static + D9-2 runtime financial guards                      |
| Deny-wins policy precedence                  | Governance                | `policy-engine.ts:310-320`                                                            | A single matched deny beats any number of allows                                     |
| Risk scoring and categories                  | Governance                | `packages/core/src/engine/risk-scorer.ts:55,63`                                       | Weighted score mapped to none..critical, drives approval routing                     |
| Spend-approval threshold (autonomy lever)    | Governance                | `spend-approval-threshold.ts:42`                                                      | Opt-in relaxation of reversible under-threshold financial approvals                  |
| ApprovalLifecycleStatus state machine        | Governance                | `packages/schemas/src/approval-lifecycle.ts:3-10`                                     | Six-state durable HITL lifecycle                                                     |
| Binding hash integrity                       | Governance                | `packages/core/src/approval/binding.ts:4-22`                                          | Content hash so approve commits exactly what was shown                               |
| Approve materialization + optimistic lock    | Governance                | `prisma-lifecycle-store.ts:183-227`                                                   | Frozen ExecutableWorkUnit under version+org predicate                                |
| Dispatch-or-recovery invariant               | Governance                | `packages/core/src/approval/lifecycle-dispatch.ts:79-121`                             | Approved action always lands visible terminal-or-recoverable                         |
| Claim type classifier (Haiku 4.5)            | Governance                | `anthropic-classifier.ts:69-90`; `claim-classifier.ts:12`                             | Strict-tool LLM classifier into 9 regulated claim types                              |
| Substantiation resolver + paraphrase match   | Governance                | `substantiation-resolver.ts:16-26,108-114`                                            | Tiered grounding of flagged sentences against approved/regulatory sources            |
| ClaimClassifierHook (off/observe/enforce)    | Governance                | `skill-runtime/hooks/claim-classifier.ts:101-131`                                     | Post-generation governance hook that rewrites or escalates                           |
| Agent Manifest + autonomy enum               | Agentic                   | `packages/sdk/src/manifest.ts:15`                                                     | Declarative starting-autonomy that indexes the policy matrix                         |
| Skill Loader + tool-reference validation     | Agentic                   | `packages/core/src/skill-runtime/skill-loader.ts:28`                                  | Compiles SKILL.md prompt-as-code, cross-checks declared tools                        |
| Tool factories (injection defense)           | Agentic                   | `skill-runtime/tools/crm-query.ts:15`; `crm-write.ts:31`                              | Close over trusted orgId/contactId; model never supplies identity                    |
| Governance policy matrix (effect x trust)    | Agentic                   | `packages/core/src/skill-runtime/governance.ts:19`                                    | Lookup table mapping effect category x trust level to a decision                     |
| Skill Executor (bounded agent loop)          | Agentic                   | `packages/core/src/skill-runtime/skill-executor.ts:1`                                 | The tool-calling loop with turn/token/wall-clock budgets                             |
| Platform Ingress (one front door)            | Agentic                   | `packages/core/src/platform/platform-ingress.ts:93`                                   | Single mandatory `submit()` for every mutating action                                |
| executorBySlug override                      | Agentic                   | `packages/core/src/platform/modes/skill-mode.ts:32`                                   | Per-slug executor so Mira runs zero-hook for internal compose                        |
| Trajectory grading eval                      | Agentic                   | `evals/trajectory-grading/grade.ts:96-206`                                            | Recomputes the approval mandate from un-fudgeable facts                              |
| Governance decision eval + drift guard       | Agentic                   | `evals/governance-decision/decide.ts:42-51`                                           | Pins the live approval matrix via the real gate function                             |
| Executor trust contract test                 | Agentic                   | `packages/core/src/skill-runtime/__tests__/executor-trust-contract.test.ts:43-100`    | Proves injected `orgId` is dropped for context-bound org                             |
| Route governance checker                     | Agentic + Governance      | `.agent/tools/check-routes.ts`                                                        | Static analysis enforcing the one-audited-front-door rule                            |

---

# Pillar 1: Data systems and partnership readiness

This pillar covers how Switchboard models trust signals, provenance, consent, freshness, identity, and tamper-evident audit records. These are the data-foundation concepts every governance and agentic layer above depends on.

---

## Schema contracts & quality floors

This pillar is about a single discipline: **never let an unbounded or unvalidated number drive a customer-facing decision.** Switchboard learns from conversations (it extracts "patterns" and "facts" from chats), scores how much it trusts each one, and only injects the trusted ones into the prompts that an AI agent (Alex the booking agent, Mira the analyst) sends to customers. The "schema contract" is the typed, validated shape of that trust signal; the "quality floor" is the threshold a piece of learned knowledge must clear before it is allowed to influence a real reply. Getting these wrong means either a hallucinated pattern reaches a customer, or a genuinely useful learning never surfaces. The sections below walk the producers, enforcers, and consumers of that machinery.

A useful mental model before diving in: there are **two numbers** attached to every learned memory, `confidence` (how sure we are) and `sourceCount` (how many independent observations back it). Most of this pillar is about how those two numbers are derived, validated, persisted, decayed, and gated.

### Confidence Score Schema (the `[0,1]` contract)

**Concept.** A confidence score is a probability-like trust value. The transferable idea is _parse-don't-validate_: instead of writing defensive `if (c < 0 || c > 1)` checks scattered across the codebase, you declare the legal range once, at the boundary where untrusted data (here, LLM output) enters your typed world, and let a schema library reject anything out of range at parse time. After that point every consumer can assume the invariant holds.

**In Switchboard.** The platform uses [Zod](https://zod.dev) (a TypeScript schema/validation library). Every domain model that carries a confidence declares the identical constraint `z.number().min(0).max(1)`:

```ts
// packages/schemas/src/deployment-memory.ts:36, 63
export const ExtractedFactSchema = z.object({
  fact: z.string(),
  confidence: z.number().min(0).max(1),     // line 36, no default
  category: DeploymentMemoryCategorySchema,
});
// ...
  confidence: z.number().min(0).max(1).default(0.5),  // line 63, DeploymentMemory
```

The same one-liner recurs across unrelated domains: `temporal-fact.ts:45` (`.default(1.0)` for owner-asserted facts) and `:73` (required, no default, for stored facts), `claim-classifier.ts:29`, `recommendations.ts:50`, `chat.ts:88`, and `ad-optimizer.ts:227`. The defaults differ deliberately: a deployment memory starts at 0.5 (a coin-flip), a temporal fact recorded by an owner starts at 1.0 (we trust the human). Zod is the **enforcer** here. The **producers** are LLM extraction calls and operator inputs; the **consumers** are the floor comparisons described below.

**How it's used at runtime.** An inbound chat completes, an extraction LLM emits `{ fact, confidence, category }`, and that JSON is run through `ExtractedFactSchema.parse(...)`. If the model hallucinated `confidence: 1.4`, the parse throws before the value can ever be compared against a surfacing floor. The contract is the chokepoint.

**Gotchas / study next.** Zod runs in `strict` mode in some tool-call paths, and a separate gotcha in this codebase is that Anthropic's strict tool schema rejects `min`/`max` JSON-schema keywords, so confidence bounds enforced via Zod at the application layer are _not_ always expressible in the tool definition handed to the model. The bound is enforced on the way back in, not on the way out.

### computeConfidenceScore (deriving trust from evidence count)

**Concept.** Rather than asking an LLM "how confident are you?" (models are poorly calibrated), you can derive confidence _deterministically_ from how many times you have independently observed the same thing. This is a Bayesian-flavoured idea: more corroborating observations, more trust, with diminishing returns.

**In Switchboard.** `deployment-memory.ts:79-82` is the whole formula:

```ts
export function computeConfidenceScore(sourceCount: number, ownerConfirmed: boolean): number {
  if (ownerConfirmed) return 1.0;
  return Math.min(0.95, 0.5 + 0.15 * Math.log(sourceCount));
}
```

A natural-log curve floored at 0.5 (sourceCount=1) and capped at 0.95 (no machine-learned pattern is ever "certain"; only an owner confirmation reaches 1.0). The tests at `__tests__/deployment-memory.test.ts:83-103` pin the curve: sourceCount=1 to 0.5, =2 to ~0.6, =3 to ~0.66 (exactly the steady-state floor, by design), =100 to 0.95. The **consumer** is `compounding-service.ts`: on a merge it calls `computeConfidenceScore(newSourceCount, false)` (line 480) and on a fresh pattern `computeConfidenceScore(1, false)` (line 507).

**How it's used at runtime.** When a new outcome pattern is recorded, the service either creates it (confidence 0.5) or, if a near-duplicate exists, increments the existing one's sourceCount and recomputes confidence. Confidence is **never persisted as the source of truth for derivation**; it is recomputed from sourceCount on every merge. The stored `confidence` column is a denormalized cache for query-time filtering.

**Gotchas / study next.** Because confidence is a pure function of sourceCount, sourceCount=3 deterministically yields 0.66 which is exactly `SURFACING_THRESHOLD.minConfidence`. The two floors are tuned to fire together, but they are checked independently (see below), so a pattern whose confidence was _decayed_ below 0.66 while still at sourceCount=3 will fail surfacing on the confidence axis alone.

### sourceCount (the corroboration counter)

**Concept.** A monotonic counter of independent evidence. The design rule worth internalizing: **counts go up, confidence goes down** (via decay), but you never decrement the count. That keeps "how much have we seen this" honest even as "how fresh is it" erodes.

**In Switchboard.** Schema: `z.number().int().positive().default(1)` (`deployment-memory.ts:64`, also the `ConfidenceFormulaSchema` input at `:72`). Storage: `schema.prisma:777` declares `sourceCount Int @default(1)`. The store increments it atomically: `prisma-deployment-memory-store.ts:36` runs `sourceCount: { increment: 1 }` inside `incrementConfidence`. Note line 41 throws `StaleVersionError` when `result.count === 0`, because `updateMany` silently returns `{count: 0}` on a no-match rather than throwing, so the guard restores fail-loud semantics.

**How it's used at runtime.** Surfacing queries filter `sourceCount: { gte: minSourceCount }` (line 68). Pilot mode additionally counts _distinct booking-ids_ from a separate `DeploymentMemoryEvidence` table to let a sourceCount=1 pattern surface if it has two independent real bookings behind it.

**Gotchas / study next.** sourceCount is an **integer**; confidence is a **float**. Two different axes, two different floors, never collapse them into one score. The whole pilot-vs-steady design hangs on being able to relax one axis without the other.

### SURFACING_THRESHOLD (the steady-state quality floor)

**Concept.** A quality floor is a hard gate that decides whether learned knowledge is good enough to act on. Centralizing it as one immutable constant means the gate is auditable and testable rather than re-derived at each call site.

**In Switchboard.** `deployment-memory.ts:85`:

```ts
export const SURFACING_THRESHOLD = { minSourceCount: 3, minConfidence: 0.66 } as const;
```

It is enforced in three places that must agree: the DB query `listHighConfidence` (`prisma-deployment-memory-store.ts:57-72`, `gte` on both columns), the pure predicate `filterSurfaceablePatterns` (`outcome-pattern-extractor.ts:20-26`), and the `ContextBuilder` that assembles agent prompts (`context-builder.ts:135-138`). Mira's builder also reads through it (`mira.ts:255-259`). The DB query is a coarse pre-filter; the in-process predicate is the authoritative second check.

**How it's used at runtime.** Inbound message to `ContextBuilder.build()` to `listHighConfidence(orgId, depId, 0.66, 3)` to category-split (patterns vs facts) to `filterSurfaceablePatterns` to `renderOutcomePatternsForContext` to the prompt envelope. A pattern at sourceCount=2/confidence=0.62 is rejected at the steady floor (asserted in context-builder tests).

**Gotchas / study next.** The two-stage filter is _belt and suspenders_: the DB and the in-process predicate use the same constant, so why filter twice? Because the in-memory test fixtures and the pilot path can return candidates below the steady floor, the `filterSurfaceablePatterns` call at `context-builder.ts:176-180` is what guarantees a sourceCount=5/confidence=0.50 row (which the DB query would return) never reaches the prompt.

### Pilot Mode surfacing thresholds (relaxed floors for small cohorts)

**Concept.** Quality floors tuned for steady-state starve a brand-new deployment of any learning. The pattern is a _graduated gate_: lower the bar while data is thin, with an evidence-based escape hatch so the lower bar does not just admit noise.

**In Switchboard.** `outcome-pattern-extractor.ts:32-34` defines three constants (`PILOT_SURFACING_MIN_SOURCE_COUNT=2`, `PILOT_SURFACING_MIN_CONFIDENCE=0.6`, `PILOT_MULTI_BOOKING_MIN_DISTINCT=2`) and `filterPilotModeSurfaceable` (lines 40-72) runs two passes: a cheap threshold pass (no DB), then a parallel evidence lookup for sub-threshold patterns that counts distinct booking-ids. `context-builder.ts:135-138` lowers the DB query to `minConfidence=0.6, minSourceCount=1` when `pilotMode` is set so candidates are even visible to the pilot filter.

**How it's used at runtime.** Enabled per-deployment via `AgentDeployment.inputConfig.outcomePatterns.pilotMode` (documented at `context-builder.ts:50-55`). A sourceCount=1 pattern surfaces only if `countDistinctBookingIds` returns >= 2; with no `evidenceStore` wired it degrades to threshold-only.

**Gotchas / study next.** The DB-side lowering and the application-side rule are two different gates that must move together. If you lowered the query but forgot the filter (or vice versa), you would either silently surface garbage or never let the evidence branch fire. Also note the second pass runs `Promise.all` over evidence lookups, so a slow evidence store directly taxes prompt-build latency.

### Confidence Floor in the Claim Classifier hook (don't act on a guess)

**Concept.** When a classifier's own confidence is low, the safest action is _no action_. A low-confidence "this is a medical claim" verdict that triggers a rewrite is worse than leaving the sentence alone. So you gate the _enforcement_ on the classifier's self-reported confidence.

**In Switchboard.** Config schema `governance-config.ts:46`: `confidenceThreshold: z.number().min(0).max(1).default(0.7)`. The enforcer is `claim-classifier.ts:261`:

```ts
if (result.claimType === "none") return { kind: "allow" };
// T1.1 confidence floor: below the floor we allow rather than act on a guess.
if (result.confidence < confidenceThreshold) return { kind: "allow" };
```

This fires uniformly for _all_ non-"none" claim types, both rewriteable (efficacy, safety-claim, superiority, urgency) and escalate-only (testimonial, medical-advice, diagnosis). Tests (`claim-classifier.test.ts:489-543`) confirm a 0.6-confidence efficacy claim is allowed unchanged at the default 0.7 floor, but a deployment configured to 0.5 _will_ act on the same 0.6 claim.

**How it's used at runtime.** Agent emits a reply, the `afterSkill` hook splits it into sentences, runs the classifier, and `decideAction` either allows, rewrites, or escalates per sentence. Note that timeout/error outcomes carry no confidence and still escalate (lines 215-242), so the floor only relaxes _successful but unsure_ classifications.

**Gotchas / study next.** The comment at `:45` flags this is "a principled default, not an operator UI knob." The ordering matters: the `claimType === "none"` short-circuit precedes the confidence floor, and error/timeout escalations precede both. Study why "fail toward escalate on error, fail toward allow on low confidence" is the correct asymmetry.

### OUTCOME_PATTERN_MERGE_THRESHOLD (semantic dedup floor)

**Concept.** LLM extraction phrases the same insight ten different ways. Without dedup you get pattern fragmentation, ten low-confidence entries instead of one high-confidence one. The fix is _semantic_ dedup: embed each pattern into a vector and merge when cosine similarity (the angle between two embedding vectors, 1.0 = identical meaning) clears a floor.

**In Switchboard.** `deployment-memory.ts:103` exports `OUTCOME_PATTERN_MERGE_THRESHOLD = 0.84`. `compounding-service.ts:472` compares the new pattern's embedding against existing entries _in the same canonical-key bucket_; on a match it merges by incrementing sourceCount instead of creating a duplicate. Distinct from the legacy `SIMILARITY_THRESHOLD` (0.92) used at line 497 as a _cross-key collision detector_ (it does not merge, it just increments a metric flagging a possibly mis-calibrated enum).

**How it's used at runtime.** New booked-conversation pattern to `recordOutcomePattern` to embed to same-bucket scan to `>= 0.84` merge-or-create. The 0.84 is deliberately conservative; comments at `:94-102` document a ratchet path to 0.80/0.78 once the cross-key collision counter proves the canonical enum is well-calibrated.

**Gotchas / study next.** Two thresholds, two jobs: 0.84 _merges_ within a key, 0.92 _flags_ across keys. They are not interchangeable, and the merge is scoped to a canonical-key bucket so genuinely different intents never collapse.

### Persistence and decay (the floors live in the database)

**Concept.** Quality floors are only as good as the storage that respects them. Two ideas: filter at the database (`WHERE confidence >= ...`) rather than loading everything into memory, and let stale knowledge _decay_ so old learnings fade rather than persisting at full trust forever.

**In Switchboard.** `schema.prisma:769-787` stores `confidence Float @default(0.5)`, `sourceCount Int @default(1)`, plus `@@index([confidence])` (for ordering/eviction) and `@@index([organizationId, deploymentId])` (multi-tenant isolation). Eviction picks the lowest-confidence, oldest entry (`prisma-deployment-memory-store.ts:109-114`). Decay (`:116-135`) batch-decrements confidence for entries unseen past a cutoff, with a `confidence: { gt: input.floor }` guard so nothing decays below the floor, and a `lastDecayedAt` stamp preventing double-decay in one day:

```ts
where: {
  lastSeenAt: { lt: input.cutoffDate },
  confidence: { gt: input.floor },     // never decay below floor
  OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: input.startOfDay } }],
},
data: { confidence: { decrement: input.decayAmount }, lastDecayedAt: new Date() },
```

Constants live in schema (`DECAY_WINDOW_DAYS=90`, `PATTERN_DECAY_WINDOW_DAYS=180`, `deployment-memory.ts:91-92`). The store interface contract `ContextBuilderDeploymentMemoryStore.listHighConfidence` (`context-builder.ts:66-84`) requires both threshold params, decoupling the consumer from Prisma so pilot vs steady thresholds are a caller decision, not a storage change.

**How it's used at runtime.** A daily decay job sweeps unreinforced memories down; a reinforcement (`incrementConfidence`) bumps confidence back up and stamps `lastSeenAt`. The net effect is a self-maintaining knowledge base where useful patterns stay surfaceable and forgotten ones drift below the floor.

**Gotchas / study next.** The `>` (not `>=`) floor guard means an entry sitting _exactly at_ the floor will still be skipped (it must be strictly above to decay), so memories settle at a floor and stay. And every mutating store method uses `updateMany`/`deleteMany` with a `count === 0` throw, because Prisma's bulk operations drop the P2025 not-found error that the single-row variants raise. Study that pattern; it is the reason a "stale" or wrong-org write fails loudly instead of silently no-op'ing.

---

## Provenance, source counting, attribution tiers & WorkTrace lineage

This pillar is about a single hard question that every AI-driven revenue platform eventually has to answer in court, in a compliance review, or in an analytics dashboard: **"who did what, on whose behalf, and what did it cause?"** When an LLM agent can pause an ad campaign, message a lead, or book a treatment, you cannot trust the model's own narration of what happened. You need a tamper-evident, server-authored record of every governed action, and you need a chain that links that action to a real customer, a real conversation, and ultimately a real dollar. Switchboard builds this out of four interlocking ideas: an immutable audit row (`WorkTrace`), server-resolved lineage fields welded onto it, a confidence ladder for revenue evidence, and a memory layer that counts corroborating sources before it trusts a fact. Below, each concept is taught from the general principle down to the exact code.

---

### WorkTrace: the canonical immutable audit row

**Concept.** In event-sourced and audit-heavy systems, you separate the _mutation_ (book the appointment) from the _record of the mutation_ (a row describing the decision, the actor, the outcome). The record is append-mostly and eventually sealed, so it can serve as evidence even if the underlying domain data later changes. This is the "custody of proof" pattern: the proof document is a first-class artifact, not a log line.

**In Switchboard.** A `WorkTrace` is the row recording one work-unit submission from governance through completion. Its shape lives at [`packages/core/src/platform/work-trace.ts:6-109`](../../../../packages/core/src/platform/work-trace.ts). It captures three things at once: the governance decision (`governanceOutcome`, `riskScore`, `matchedPolicies`), the execution result (`outcome`, `executionSummary`, `executionOutputs`, `durationMs`), and lineage (`workUnitId`, `traceId`, `parentWorkUnitId`, `contactId`, `conversationThreadId`).

The producer is `buildWorkTrace()` in [`work-trace-recorder.ts:66-122`](../../../../packages/core/src/platform/work-trace-recorder.ts), which derives the row's outcome from whether execution happened yet:

```ts
let outcome: WorkTrace["outcome"];
if (executionResult) {
  outcome = executionResult.outcome;
} else if (governanceDecision.outcome === "deny") {
  outcome = "failed";
} else {
  outcome = "pending_approval";
}
```

The orchestrator is `IngressTracePersister` ([`ingress-trace-persister.ts:59-90`](../../../../packages/core/src/platform/ingress-trace-persister.ts)). Note a subtlety the mapping under-stated: there is a **claim-first** path. Before the domain mutation runs, `claimIdempotency()` persists a `running` trace (built by `buildClaimTrace`) as a concurrency lock keyed on `(organizationId, idempotencyKey)`. After execution, `finalizeTrace()` updates that same row to its terminal outcome. The persister never throws; on terminal failure it emits exactly one infrastructure-failure audit plus one operator alert, then leaves the `running` claim in place so a retry fails closed.

**How it's used at runtime.** Inbound message arrives at a channel adapter, becomes a `WorkUnit`, and enters `PlatformIngress.submit()`. Ingress evaluates governance, calls `claimIdempotency()` (claim the key, persist `running`), dispatches the tool, then `finalizeTrace()` to seal the outcome. The store also writes an `audit.record({ eventType: "work_trace.persisted" })` inside the **same** Prisma transaction ([`prisma-work-trace-store.ts:52-90`](../../../../packages/db/src/stores/prisma-work-trace-store.ts)), so the audit anchor and the row can never diverge.

**Gotchas / what to study next.** (1) `update()` returns two different shapes by environment: a locked row returns `{ ok: false, code: "WORK_TRACE_LOCKED" }` in prod but throws `WorkTraceLockedError` in non-prod tests. Every consumer must handle both. (2) `persist()` deliberately swallows the unique-constraint error _only when_ `idempotencyKey` is set (line 92); `claim()` must not, because that void is its concurrency signal.

---

### Lineage chain-weld: `contactId` and `conversationThreadId`

**Concept.** To trace "which action caused which revenue," you need stable join keys that do not depend on the LLM. The trap is letting the model supply identity ("this is for customer Alice") because a hallucinated id corrupts your entire revenue ledger. The fix: resolve identity _server-side_ from request context, then weld it onto the audit row as an index, not as part of the integrity hash.

**In Switchboard.** `contactId` and `conversationThreadId` are the Spec-1A "chain weld." They flow `WorkUnit.contactId` -> `buildWorkTrace()` at [`work-trace-recorder.ts:119-120`](../../../../packages/core/src/platform/work-trace-recorder.ts) -> the Prisma row. Crucially they are **excluded from the content hash** at [`work-trace-hash.ts:23-29`](../../../../packages/core/src/platform/work-trace-hash.ts):

```ts
// Spec-1A chain weld: lineage/index columns ... Downstream-derivable from
// parameters, never the executed input. Excluded so the new nullable
// columns leave every existing row's contentHash byte-identical.
"contactId",
"conversationThreadId",
```

That exclusion is the load-bearing design choice: because lineage is derivable from `parameters`, hashing it is redundant, and excluding it means adding the columns did **not** invalidate every pre-existing row's hash (no `hashInputVersion` bump needed). They are indexed on the Prisma model for lineage queries.

**How it's used at runtime.** Revenue attribution joins `Booking.workTraceId` to `WorkTrace.workUnitId`, then reads the attached `contactId` to walk back to the conversation. This is what makes the booking-attribution resolver below possible without trusting any model output.

**Gotchas.** Anything in `EXCLUDED_BASE` (also `injectedPatternIds`, `lockedAt`, `traceVersion`, `contentHash` itself) is analytics/lineage metadata, _not_ execution integrity. When you add a new column, ask: "is this part of what was executed, or downstream-derivable from it?" Derivable means exclude.

---

### WorkTrace integrity: `contentHash`, `traceVersion`, sealed state

**Concept.** Tamper-evidence via content addressing: hash the canonical serialization of the meaningful fields; store the hash; later re-hash and compare. A monotonic version counter binds the hash to a specific revision so a stale-but-valid hash cannot be replayed.

**In Switchboard.** `computeWorkTraceContentHash()` ([`work-trace-hash.ts:96-98`](../../../../packages/core/src/platform/work-trace-hash.ts)) is `sha256(canonicalizeSync(buildWorkTraceHashInput(...)))`. The hash binds two versions: `hashVersion` (the algorithm/shape version) and `traceVersionForHash` (the row revision), the latter named distinctly so it cannot collide with the excluded `traceVersion` field. Two shapes exist: `V1` (legacy rows, pre-`ingressPath`) and `V2` (new rows include `ingressPath`), selected per-row by its own `hashInputVersion` so old rows keep verifying.

Verification is `verifyWorkTraceIntegrity()` ([`work-trace-integrity.ts:47-78`](../../../../packages/core/src/platform/work-trace-integrity.ts)). Correcting the mapping: the verdict union is **`ok | mismatch | missing_anchor | skipped`** (not `hash_mismatch | version_mismatch`). A row with `contentHash === null` but `requestedAt` before the migration cutoff returns `skipped: "pre_migration"`; one after cutoff returns `missing_anchor`. A re-hash disagreement returns `mismatch`. The anchor cross-check compares the row's hash/version against the audit-ledger snapshot:

```ts
const anchorHash = getString(anchor.snapshot, "contentHash");
const anchorVersion = getNumber(anchor.snapshot, "traceVersion");
if (anchorHash !== rowContentHash || anchorVersion !== rowTraceVersion) {
  return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
}
```

**How it's used at runtime.** `assertExecutionAdmissible()` throws `WorkTraceIntegrityError` on any non-`ok` verdict unless an explicit operator override is supplied, and the override path itself is audited at `riskCategory: "high"`. This is what lets WorkTrace serve as proof: you cannot consume a tampered row silently.

**Gotchas.** `contentHash` present but `traceVersion <= 0` is treated as `missing_anchor`, never `ok` (line 58). And canonical JSON ordering matters: the hash is over `canonicalizeSync` output, so two semantically equal objects with different key order must still hash identically.

---

### Ingress path discriminator

**Concept.** Not every audit row comes through the same door. Distinguishing the _provenance of the record itself_ lets compliance filter "rows that passed governance" from "operator side-writes" and "advisory emissions."

**In Switchboard.** `ingressPath` ([`work-trace.ts:72-75`](../../../../packages/core/src/platform/work-trace.ts)) is one of `platform_ingress` (default, passed the gate), `store_recorded_operator_mutation` (a store wrote it outside ingress, e.g. `ConversationStateStore`), or `agent_recommendation_emission` (an advisory Riley emission paired with a `Recommendation` row, _not_ a tool execution). It is part of the V2 hash input ([`work-trace-hash.ts:40`](../../../../packages/core/src/platform/work-trace-hash.ts)), which is precisely why V1 had to exclude it.

**How it's used.** "Which governance decisions touched this outcome?" filters `ingressPath = "platform_ingress"`. Advisory emissions surface separately so the operator can see what the agent _recommended_ versus what was actually _executed_ under governance.

---

### Attribution confidence tiers (revenue-proof strength)

**Concept.** Not all revenue evidence is equal. A hard ad-click id is proof; a bare channel guess is a hint. Bucketing into an ordered ladder lets downstream reporting weight or exclude weak evidence without throwing it away.

**In Switchboard.** `scoreAttribution()` ([`score-attribution.ts:28-40`](../../../../packages/core/src/receipts/score-attribution.ts)) is a precedence-ordered pure enum mapping over `AttributionEvidence`:

```ts
if (evidence.leadgenId || evidence.sourceAdId) return "deterministic";
if (
  evidence.sourceCampaignId &&
  evidence.sourceType &&
  FIRST_PARTY_SOURCE_TYPES.has(evidence.sourceType)
)
  return "high";
if (evidence.sourceCampaignId || evidence.sourceChannel) return "medium";
if (evidence.sourceType) return "low";
return "unattributed";
```

The five rungs are defined once in [`receipted-booking.ts:8-14`](../../../../packages/schemas/src/receipted-booking.ts). It is deliberately threshold-free: there are no numeric comparisons, so there is no NaN-blind gate to exploit (a recurring class of bug in this codebase, see `feedback_nan_blind_comparison_gates`).

**How it's used at runtime.** At booking-receipt issuance, `buildReceiptedBookingData()` ([`build-receipted-booking-data.ts:71`](../../../../packages/core/src/receipts/build-receipted-booking-data.ts)) calls `scoreAttribution` once and stamps the result as a **snapshot**. `unattributed` does not drop the booking; it raises a `missing_source` exception entry. The confidence is never live-recomputed; only exceptions (consent, PDPA, duplicate contact) are re-evaluated.

**Gotchas.** Snapshot semantics are the whole point: a receipt issued at confidence `high` stays `high` even if later evidence arrives, because the receipt is a point-in-time proof, not a live view. Exceptions are resolved by _stamping_ `resolvedAt`, never by deletion.

---

### Booking-backed outcome attribution (CTWA -> Alex -> work unit -> booking -> revenue)

**Concept.** To learn from outcomes, you must decide _how confidently_ a conversation caused a booking. A strong link is a direct tool-execution match; a weak link is "a booking appeared near this contact afterward." Mislabeling weak as strong poisons your learning loop.

**In Switchboard.** `resolveBookingAttribution()` ([`booking-attribution.ts:41-79`](../../../../packages/core/src/memory/booking-attribution.ts)) is two-tier. Tier 1 (`strong`) matches `Booking.workTraceId` against the conversation's executed-tool `workTraceIds`. Tier 2 (`fallback`) searches the same org+contact in the post-conversation 24h window. Otherwise `none`. The store contract mandates `createdAt ASC` ordering so "first row wins" is deterministic regardless of query plan.

**How it's used at runtime.** `ConversationCompoundingService` calls this when a conversation ends. `none` **suppresses pattern extraction entirely**, regardless of what the LLM's `summarization.outcome` claimed. `strong` enables precise pattern extraction tied to the exact tool turn.

**Gotchas.** The fallback window is post-conversation only; pre-conversation bookings are excluded because they were likely caused by an earlier touchpoint. Per-deployment scoping is intentionally _not_ enforced because neither `Booking` nor `Contact` carries a `deploymentId` today (a deliberate, documented limitation, not an oversight).

---

### Source counting with the confidence formula

**Concept.** An LLM extracting facts from one conversation is speculative. Requiring _corroboration across multiple independent sources_ before trusting a fact is the classic defense against single-shot hallucination, with a diminishing-returns curve so the tenth witness adds less than the second.

**In Switchboard.** Each `DeploymentMemory` row carries `sourceCount` (>= 1) and a `confidence` in [0,1]. The formula ([`deployment-memory.ts:79-82`](../../../../packages/schemas/src/deployment-memory.ts)) is logarithmic:

```ts
export function computeConfidenceScore(sourceCount, ownerConfirmed) {
  if (ownerConfirmed) return 1.0;
  return Math.min(0.95, 0.5 + 0.15 * Math.log(sourceCount));
}
```

So `sourceCount=1` -> 0.65, 3 -> ~0.66, 10 -> ~0.85, ceiling 0.95. Owner-confirmed jumps to a clean 1.0. The compounding service derives the new-fact constant from the formula rather than hardcoding it ([`compounding-service.ts:121-125`](../../../../packages/core/src/memory/compounding-service.ts)) so it cannot drift. Surfacing requires both `sourceCount >= 3` and `confidence >= 0.66` ([`deployment-memory.ts:85`](../../../../packages/schemas/src/deployment-memory.ts)), applied by `filterSurfaceablePatterns()` ([`outcome-pattern-extractor.ts:20-26`](../../../../packages/core/src/memory/outcome-pattern-extractor.ts)).

**How it's used.** Facts extracted from conversations only enter agent context once corroborated 3+ times. One-offs stay latent. Pilot deployments use looser thresholds (`PILOT_SURFACING_*`, source count 2) because small cohorts learn faster.

**Gotchas.** Corroboration is gated on similarity (0.92 for facts, 0.84 for outcome patterns) so two phrasings of the same fact merge instead of double-counting. And `CustomerFact` strips `sourceCount`/`confidence` before customer-facing output: the anti-regurgitation policy means the _agent_ knows the corroboration math but the customer never sees "we believe this with 0.77 confidence."

---

### Riley outcome attribution & the corroboration predicate

**Concept.** To claim an action _worked_, you compare a metric before and after over a window, then optionally check whether an _independent second estimate_ agrees. The discipline is refusing to over-claim: directional movement is not causal proof, and corroboration is agreement, not causation.

**In Switchboard.** `attributeOneRecommendation()` ([`outcome-attribution.ts:47-200`](../../../../packages/core/src/recommendations/outcome-attribution.ts)) builds a `RileyOutcomeRow` from a recommendation plus pre/post Meta `WindowMetrics`. Per-kind config ([`outcome-attribution-config.ts:7-23`](../../../../packages/core/src/recommendations/outcome-attribution-config.ts)) sets windows (pause: 7d/spend/down, refresh_creative: 14d/ctr/up). It raises visibility flags (`meta_data_missing`, `zero_pre_baseline`, `same_campaign_overlap`, `same_kind_retry`, `below_noise_floor`); any flag forces `causalStrength = "inconclusive"` and blocks rendering. The row's `executableWorkUnitId` ([`outcome-attribution-types.ts:174-200`](../../../../packages/core/src/recommendations/outcome-attribution-types.ts)) links back to the work unit that executed the recommendation, closing the loop to WorkTrace lineage.

The upgrade from `directional` to `corroborated` runs through `deriveCorroboration()` ([`outcome-corroboration.ts:123-200`](../../../../packages/core/src/recommendations/outcome-corroboration.ts)), six rejection gates then numeric floors: pause-only, no visibility flags, favorable delta, not operator-unstable, all inputs present and finite, then >=3 valued bookings per window, post account-spend within [0.5x, 1.5x] of pre (the comparable-regime band), and post booked-revenue-per-dollar ratio >= 0.8x pre. The `Number.isFinite` guard sits _before_ every comparison because `NaN >= 0` is false, so a single Meta-string-as-number could otherwise sail through to a fabricated `corroborated`.

**How it's used.** `cockpitRenderable` gates display; `trustDelta` (up/none/down) feeds the operator outcome feed. `shift_budget_to_source` is a fully designed blueprint (`KIND_CONFIG_PENDING`, `SPEC_1B_PENDING_KINDS`) but inert because it has no executor yet, so there is no executed anchor to attribute against.

**Gotchas.** The corroboration `reason` field exists purely so tests pin the exact rejecting gate and rollout debugging never reconstructs _why_ corroborated stayed off. And the spec is explicit: "no consumer may treat corroborated as causal proof." It only ever _upgrades_, never demotes.

---

### WorkTraceQualificationSignals sidecar (audit lineage only)

**Concept.** When you parse model output, preserve the _raw rejected text_ for post-hoc debugging, but keep that audit sidecar strictly separate from operational routing so a parse failure cannot stall a queue.

**In Switchboard.** `WorkTraceQualificationSignalsSchema` ([`qualification-signals.ts:42-52`](../../../../packages/schemas/src/qualification-signals.ts)) is a discriminated union on `validationStatus`: `ok` carries the parsed payload; `multiple_blocks`/`malformed_json`/`schema_mismatch` carry the raw string for replay. Stored on `WorkTrace.qualificationSignals` ([`work-trace.ts:88`](../../../../packages/core/src/platform/work-trace.ts)). The invariant: operational lifecycle queues **must not** scan this column; they read `ConversationLifecycleSnapshot`/`Transition` instead. The sidecar is for "what did the model output that was unparseable," nothing more.

---

### Injected pattern IDs (per-turn outcome-pattern lineage)

**Concept.** To measure whether a piece of injected context actually lifts conversion, you must record _which_ context entered _which_ turn, so you can later correlate turns-that-saw-pattern-X against turns-that-did-not.

**In Switchboard.** `injectedPatternIds` ([`work-trace.ts:92-95`](../../../../packages/core/src/platform/work-trace.ts)) records the `DeploymentMemory` ids rendered into the `<outcome-patterns>` envelope for that turn, populated from `ExecutionResult.injectedPatternIds` in `buildWorkTrace` ([`work-trace-recorder.ts:111`](../../../../packages/core/src/platform/work-trace-recorder.ts)), defaulting to `[]`. It is excluded from the content hash ([`work-trace-hash.ts:19-22`](../../../../packages/core/src/platform/work-trace-hash.ts)) as downstream-derivable analytics metadata. Stored as a JSON array for `unnest()`-style conversion-lift joins against `DeploymentMemory`.

**Gotchas.** This is the measurement primitive that lets the team prove the memory system's ROI rather than assume it: surfacing a pattern (gated by the source-count formula above) is only justified if conversations that saw it convert measurably better.

---

**The through-line.** Identity is resolved server-side, never by the model; the audit row is content-hashed and sealed so it is evidence; lineage fields weld the row to a contact, a conversation, and a booking; revenue evidence is bucketed by hardness and snapshotted at issuance; and facts the agent learns must be corroborated by counted sources before they are trusted. Study `EXCLUDED_BASE` and the two `hashInputVersion` shapes first; they encode the entire "what is integrity vs. what is lineage" distinction that the rest of this pillar depends on.

---

## Auditability: hash-chained, content-addressed audit records & tenant-boundary scoped reads

This section teaches the data-integrity and tenant-isolation machinery behind Switchboard's audit trail. The platform takes mutating revenue actions on behalf of customers (approving a budget change, executing an ad spend, halting an agent), so "what happened, who decided it, and has the record been tampered with?" is not a nice-to-have. It is the trust anchor for compliance (PDPA/GDPR) and for blocking execution of tampered work. We walk from the cryptographic primitives (canonical JSON, SHA-256) up through the append-only ledger, redaction, tenant-scoped browse, the WorkTrace integrity weld, and the credential-isolation boundary that keeps one tenant's secrets from leaking into another's.

Throughout, "ledger" means the append-only audit log (`AuditLedger`), "WorkTrace" means the canonical persistence record of one platform execution, and "anchor" means an audit entry that witnesses a specific version of a WorkTrace.

### Canonical JSON serialization (the foundation for content addressing)

**Concept.** A _content address_ is an identifier derived from the bytes of the content itself (here, a SHA-256 hash). For that to be stable, serialization must be _deterministic_: the same logical object must always produce the same byte string, regardless of key insertion order or whitespace. This is the problem RFC 8785 (JSON Canonicalization Scheme) solves. Without it, `{"a":1,"b":2}` and `{"b":2,"a":1}` would hash differently even though they are the same value, and your hash chain would falsely report tampering.

**In Switchboard.** [`packages/core/src/audit/canonical-json.ts:6-23`](../../../packages/core/src/audit/canonical-json.ts) implements a dependency-free synchronous subset of RFC 8785:

```ts
if (typeof value === "object") {
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalizeSync((value as Record<string, unknown>)[k]),
  );
  return "{" + entries.join(",") + "}";
}
```

Two subtleties to internalize: keys are recursively `sort()`ed (so nesting order never matters), and `undefined`-valued keys are _dropped_ (`filter(...)`). That second rule is load-bearing for schema migration, as we will see in WorkTrace hashing: a column added later with a default of `undefined` does not change the hash of older rows.

### Hash-chained audit ledger with integrity verification

**Concept.** A _hash chain_ (the core idea behind blockchains, Git, and Certificate Transparency) makes a log _append-only and tamper-evident_. Each entry stores a hash of its own content plus the previous entry's hash. Mutating any historical entry changes its hash, which breaks the `previousEntryHash` link of the next entry, which breaks the next, and so on. You cannot quietly edit the middle of the log without rewriting everything after it, and you cannot delete an entry without leaving a gap.

**In Switchboard.** The hash input is an explicit, versioned struct (`AuditHashInput`) hashed via canonical JSON in [`packages/core/src/audit/canonical-hash.ts:25-28`](../../../packages/core/src/audit/canonical-hash.ts):

```ts
export function computeAuditHash(input: AuditHashInput): string {
  const canonical = canonicalizeSync(input);
  return sha256(canonical);
}
```

`AuditLedger.buildEntry()` ([`ledger.ts:160-182`](../../../packages/core/src/audit/ledger.ts)) assembles that input including `previousEntryHash`, hashes it into `entryHash`, and stamps `chainHashVersion: 1`. Verification recomputes every hash and re-checks every link. `verifyChain` ([`canonical-hash.ts:34-70`](../../../packages/core/src/audit/canonical-hash.ts)) returns the first `brokenAt` index on a tamper:

```ts
const recomputed = computeAuditHashSync(hashInput);
if (recomputed !== entry.entryHash) return { valid: false, brokenAt: i };
if (i > 0 && entry.previousEntryHash !== entries[i - 1]!.entryHash)
  return { valid: false, brokenAt: i };
```

`AuditLedger.deepVerify()` ([`ledger.ts:280-348`](../../../packages/core/src/audit/ledger.ts)) does the same but distinguishes a content-hash mismatch (a row's bytes changed) from a chain-link break (a row inserted/deleted), reporting both `hashMismatches[]` and `chainBrokenAt`.

**Data flow.** _Producer_: any governance event calls `AuditLedger.record()`. _Enforcer_: `buildEntry` computes the hash; the Prisma storage persists it. _Consumer_: an auditor or CI job calls `verifyChain`/`deepVerify` over a fetched range.

**Gotchas.** `traceId` is deliberately _excluded_ from the hash input ([`ledger.ts:109`](../../../packages/core/src/audit/ledger.ts), comment "not part of chain hash") because it is a request-correlation tag, not committed content. `chainHashVersion` is hashed _into_ the entry, so a future algorithm change can be introduced without invalidating old entries (you verify each entry against its own declared version).

### Atomic append with PostgreSQL advisory locks

**Concept.** A naive `read latest tail, then append` is a classic read-modify-write race. Two app instances (Kubernetes pods, autoscaled workers) could both read entry N as the tail and both write entries pointing back to N, _forking_ the chain into a branch. The fix is to serialize the read+write under a lock. PostgreSQL _advisory locks_ are application-defined locks keyed by an integer, held for the transaction's lifetime.

**In Switchboard.** [`packages/db/src/storage/prisma-ledger-storage.ts:46-106`](../../../packages/db/src/storage/prisma-ledger-storage.ts) acquires lock key `900_001` first, then reads the tail and appends inside the same transaction:

```ts
await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;
const latest = await tx.auditEntry.findFirst({ orderBy: { timestamp: "desc" } });
const previousEntryHash = latest?.entryHash ?? null;
const entry = await buildEntry(previousEntryHash);
await tx.auditEntry.create({
  data: {
    /* ...entry... */
  },
});
```

`AuditLedger.record()` ([`ledger.ts:114-119`](../../../packages/core/src/audit/ledger.ts)) prefers `appendAtomic` when the storage implements it, falling back to a non-atomic `getLatest()` + `append()` only for single-instance use. Critically, when an `externalTx` is passed, the lock and append run on the _caller's_ transaction ([`prisma-ledger-storage.ts:95-104`](../../../packages/db/src/storage/prisma-ledger-storage.ts)), so a WorkTrace row and its audit anchor commit or roll back together. `pg_advisory_xact_lock` is per-transaction, so the lock is still held until the parent transaction commits.

**Gotcha.** The advisory-lock test is a known flake source under concurrency (see project memory on `pg_advisory_xact_lock` flakes). The lock is correct; the test harness occasionally races. Study `prisma-ledger-storage.test.ts:187-262` to see how concurrent writers are simulated.

### AuditEntry schema with full provenance

**Concept.** A good audit record answers _who_ (actor), _what_ (event type), _on what_ (entity), _when_ (timestamp), _how risky_, _who may see it_ (visibility), and _what was the data_ (snapshot) plus integrity metadata. Capturing all of this in one immutable record makes it the single source of truth for investigations.

**In Switchboard.** The Zod schema ([`packages/schemas/src/audit.ts:67-107`](../../../packages/schemas/src/audit.ts)) defines actor (`actorType`/`actorId`), entity (`entityType`/`entityId`), `riskCategory`, `visibilityLevel`, `summary`, `snapshot`, `evidencePointers`, redaction metadata (`redactionApplied`/`redactedFields`), and the chain fields (`chainHashVersion`, `schemaVersion`, `entryHash`, `previousEntryHash`). The Prisma model mirrors it ([`schema.prisma:150-183`](../../../packages/db/prisma/schema.prisma)) with JSONB `snapshot`/`evidencePointers` and a compound index built precisely for org-scoped pagination:

```prisma
@@index([organizationId, timestamp(sort: Desc), id(sort: Desc)])
```

That index exactly matches the browse query's `ORDER BY timestamp DESC, id DESC` and its `(timestamp, id)` cursor comparison, so pagination stays index-only.

### Snapshot redaction (field-path + pattern based)

**Concept.** Audit snapshots can incidentally capture PII (a customer email in a message body) or secrets (an API token in a payload). _Redaction_ scrubs these before the record is sealed. Two complementary strategies: redact by _field name_ (anything called `password`) and by _value pattern_ (anything that looks like an email/phone/token via regex).

**In Switchboard.** `DEFAULT_REDACTION_CONFIG` ([`packages/core/src/audit/redaction.ts:7-16`](../../../packages/core/src/audit/redaction.ts)) lists `fieldPaths` (`credentials`, `password`, `secret`, `apiKey`, `accessToken`, `refreshToken`) and `patterns` (email, phone, `(sk|pk|api|key|token|secret)[-_]...`, credit card). `redactSnapshot` recursively walks the object, replacing matches with `[REDACTED]` and recording the path in `redactedFields`. The crucial sequencing is in `AuditLedger.buildEntry()` ([`ledger.ts:147-150`](../../../packages/core/src/audit/ledger.ts)): redaction runs _before_ hashing, so the redacted form is what gets committed to the chain:

```ts
const redactionResult = this.redactionConfig
  ? redactSnapshot(params.snapshot, this.redactionConfig)
  : { redacted: params.snapshot, redactedFields: [], redactionApplied: false };
// ...later, hashInput.snapshot = redactionResult.redacted
```

**Gotcha.** Redaction status is itself persisted (`redactionApplied`, `redactedFields`), so an auditor can see _that_ fields were hidden without seeing their values. But the regexes are conservative; if a producer puts a secret under a non-standard key with no recognizable pattern, it survives. Redaction is defense-in-depth, not a substitute for not putting secrets in snapshots.

### Email and phone masking for logs and display

**Concept.** Redaction (above) protects the stored snapshot. _Masking_ protects the much larger surface of log lines and UI text, where you still want enough of the value to debug. The rule is "never emit the raw value; emit a stable, low-entropy fragment."

**In Switchboard.** `maskEmail` ([`mask-email.ts:23-29`](../../../packages/core/src/audit/mask-email.ts)) keeps the first local-part char plus the full domain (`jason@live.com` becomes `j…@live.com`), so you can tell an approver is company-internal without learning who. `maskPhone` ([`mask-phone.ts:20-24`](../../../packages/core/src/audit/mask-phone.ts)) strips non-digits and returns the last 4 (`+65 9123 4567` becomes `…4567`). Both return a `…` fallback on malformed input and _never_ return the raw value:

```ts
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return PHONE_MASK_FALLBACK;
  return `…${digits.slice(-4)}`;
}
```

These are pure and surface-agnostic (usable in core, db, and apps), tagged to "PDPA audit F10."

### Organization-scoped browse with cursor pagination

**Concept.** In a multi-tenant system, every read of a shared table must be _scoped to the caller's tenant_ in the WHERE clause, never filtered in application code after the fact. Combine that with _keyset (cursor) pagination_: instead of OFFSET (which drifts as rows are inserted and scans skipped rows), you carry forward the last row's sort key and ask for rows strictly after it.

**In Switchboard.** `listAuditEntriesForBrowse` ([`list-entries.ts:112-165`](../../../packages/core/src/audit/list-entries.ts)) takes `organizationId` as a required argument and builds a filter; the storage applies it as a hard WHERE clause alongside a visibility gate ([`prisma-ledger-storage.ts:148-185`](../../../packages/db/src/storage/prisma-ledger-storage.ts)):

```ts
const where: Prisma.AuditEntryWhereInput = {
  organizationId: filter.organizationId,
  visibilityLevel: { in: ["public", "org"] },
};
if (filter.cursor !== null) {
  where.AND = [
    {
      OR: [
        { timestamp: { lt: cursorDate } },
        { timestamp: cursorDate, id: { lt: filter.cursor.id } },
      ],
    },
  ];
}
```

The cursor's `OR` is wrapped in `AND` deliberately: the comment ([`prisma-ledger-storage.ts:166`](../../../packages/db/src/storage/prisma-ledger-storage.ts)) calls the parens "LOAD-BEARING, without them the OR escapes the org/visibility scope." This is the single most important line for tenant safety: a bare `WHERE org AND vis OR (cursor)` would let the cursor clause match rows from _other tenants_. The cursor itself is base64url-encoded `{timestamp, id}` ([`list-entries.ts:44-65`](../../../packages/core/src/audit/list-entries.ts)), decoded with a typed guard that throws `CursorDecodeError` (mapped to HTTP 400) on tampering. Limit is clamped to `MAX_LIMIT = 100` and one extra row is fetched to compute `nextCursor`.

**Runtime path.** Dashboard `/activity` feed -> route handler reads the session's `organizationId` -> `listAuditEntriesForBrowse(ledger, organizationId, query)` -> tenant-scoped Prisma query -> `project()` -> rows. Scope toggles between `operational` (filtered to `OPERATIONAL_AUDIT_EVENT_TYPES`) and `all`; any narrowing URL param promotes the response scope to `custom` ([`list-entries.ts:101-130`](../../../packages/core/src/audit/list-entries.ts)).

### Snapshot key allowlist with redactedKeyCount projection

**Concept.** Even within a tenant, the browse API should expose _correlation_ (which action, which trace) without leaking _payloads_ (the action's internal state). An allowlist projection is stricter than a denylist: anything not explicitly named safe is hidden by default, and the count of hidden keys is surfaced for transparency.

**In Switchboard.** `SNAPSHOT_KEY_ALLOWLIST` ([`list-entries.ts:13-27`](../../../packages/core/src/audit/list-entries.ts)) is a hardcoded `Set` of safe keys (`actionType`, `decisionId`, `traceId`, `correlationId`, etc.). `project()` iterates the stored snapshot's keys, pushing allowlisted ones into `snapshotKeys` (sorted for deterministic cache keys) and counting the rest:

```ts
for (const key of Object.keys(entry.snapshot)) {
  if (SNAPSHOT_KEY_ALLOWLIST.has(key)) snapshotKeys.push(key);
  else redactedKeyCount++;
}
```

The full snapshot remains immutable in the DB; projection only strips on serialization to `AuditEntryBrowseRow`. Note `storageRef` is _deliberately omitted_ from the row's evidence pointers ([`list-entries.ts:88-93`](../../../packages/core/src/audit/list-entries.ts)) while the full `hash` is kept (it is an integrity anchor, not sensitive).

### Evidence pointers with content-hash and dual storage

**Concept.** Some audit evidence is large (an API response, a crash dump). Inlining it bloats every record; externalizing everything adds a round-trip for tiny payloads. The pragmatic answer is a _size threshold_: small content goes inline, large content is stored once and referenced by its content hash.

**In Switchboard.** `storeEvidence` ([`evidence.ts:81-100`](../../../packages/core/src/audit/evidence.ts)) canonicalizes, hashes, and branches on a 10 KB `INLINE_THRESHOLD`:

```ts
if (serialized.length <= INLINE_THRESHOLD) {
  return { type: "inline", hash, storageRef: null };
}
const storageRef = storagePrefix ? `${storagePrefix}/${hash}` : `evidence/${hash}`;
```

The pointer always carries the `hash`; only the external case carries a `storageRef`. The store is pluggable (`InMemoryEvidenceStore` for tests, `FileSystemEvidenceStore` with path-traversal guards for local, cloud for prod). `verifyEvidence(content, expectedHash)` re-hashes to detect tampering.

**Gotcha.** External storage is _fire-and-forget_ with a swallowed error ([`evidence.ts:92-97`](../../../packages/core/src/audit/evidence.ts)): "Storage failure is non-fatal, the hash is still recorded in the audit trail." That is a deliberate trade-off (the integrity claim survives even if the blob write fails), but it means a pointer can reference content that was never durably stored. The hash still proves _what it was_, but you may not be able to _retrieve_ it.

### WorkTrace content hash with versioned hash-input schema

**Concept.** The same content-addressing idea applies to the execution record (`WorkTrace`), but with a twist: the schema _evolves_. If you add a column later, naively hashing the whole row would invalidate every pre-existing hash. The solution is a _versioned hash input_: each row records which version of the hash-input rules it was created under, and you exclude or include fields per version.

**In Switchboard.** [`work-trace-hash.ts:74-98`](../../../packages/core/src/platform/work-trace-hash.ts) builds the input by version. `EXCLUDED_BASE` always omits derived/mutable fields (`contentHash`, `traceVersion`, `lockedAt`, `injectedPatternIds`, `contactId`, `conversationThreadId`); v1 additionally excludes `ingressPath` and `hashInputVersion` so older rows verify byte-identically, while v2 includes `ingressPath`:

```ts
const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
const excluded = excludedFor(hashInputVersion);
const out: Record<string, unknown> = {
  hashVersion: hashInputVersion,
  traceVersionForHash: traceVersion,
};
for (const [key, value] of Object.entries(trace)) {
  if (excluded.has(key)) continue;
  out[key] = value;
}
```

The algorithm version (`hashVersion`) and row version (`traceVersionForHash`) are bound _into_ the hash. `traceVersionForHash` uses a distinct name specifically so it cannot collide with the excluded `WorkTrace.traceVersion` field.

**Gotcha.** New nullable columns (`contactId`, `conversationThreadId`) were added to `EXCLUDED_BASE` _without_ a version bump, precisely because the canonical serializer drops `undefined` and these are downstream-derivable, never operator input. The decision of "exclude vs. bump the version" hinges on whether a field is part of the _executed input_ the operator controls. Study this file as the canonical example of evolving a content hash without breaking history.

### WorkTrace integrity verification with audit anchors

**Concept.** A content hash on a row only catches tampering if you _recompute and compare_. But a hash stored on the same row an attacker can edit is weak: change the data and the hash together. The defense is a _second witness_ in a different, append-only store (the audit chain). An _anchor_ is an audit entry whose snapshot records the row's `contentHash` and `traceVersion`. Tampering now requires forging both the row _and_ a hash-chained audit entry, which the advisory-locked chain makes evident.

**In Switchboard.** `verifyWorkTraceIntegrity` ([`work-trace-integrity.ts:47-78`](../../../packages/core/src/platform/work-trace-integrity.ts)) is a layered verdict:

```ts
if (rowContentHash === null) {
  if (rowRequestedAt < cutoffAt) return { status: "skipped", reason: "pre_migration" };
  return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
}
if (rowTraceVersion <= 0) return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
const recomputed = computeWorkTraceContentHash(trace, rowTraceVersion);
if (recomputed !== rowContentHash)
  return { status: "mismatch", expected: rowContentHash, actual: recomputed };
if (!anchor) return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
```

It then checks the anchor's snapshot `contentHash`/`traceVersion` match the row. The anchor is located via `AuditLedger.findAnchor` -> `findBySnapshotField` ([`ledger.ts:209-236`](../../../packages/core/src/audit/ledger.ts), [`prisma-ledger-storage.ts:187-211`](../../../packages/db/src/storage/prisma-ledger-storage.ts)), a JSONB-path equality query that must _not_ impose an arbitrary result limit. `assertExecutionAdmissible` ([`work-trace-integrity.ts:87-118`](../../../packages/core/src/platform/work-trace-integrity.ts)) throws on a non-`ok` verdict unless an explicit `override` is supplied, and the override is itself recorded as a `work_trace.integrity_override` event at `riskCategory: "high"`, `visibilityLevel: "admin"`. The override cannot run silently: without an `auditLedger` it throws.

**Runtime path.** On execution, the platform recomputes the WorkTrace hash, fetches its anchor, and calls `assertExecutionAdmissible`. A `mismatch` (someone patched the `outcome` column offline) blocks execution; an admin can override only by writing an admin-visibility, high-risk audit entry.

### Visibility levels and risk categories

**Concept.** Not every audit event should be visible to every user. A four-tier _visibility_ classification (`public`, `org`, `admin`, `system`) implements least-privilege reads; an orthogonal _risk_ classification (`none`/`low`/`medium`/`high`/`critical`, [`packages/schemas/src/risk.ts`](../../../packages/schemas/src/risk.ts)) drives filtering and alert routing.

**In Switchboard.** `VisibilityLevelSchema` ([`audit.ts:4-5`](../../../packages/schemas/src/audit.ts)) defines the enum; the browse storage hard-filters to `{ in: ["public", "org"] }` ([`prisma-ledger-storage.ts:151`](../../../packages/db/src/storage/prisma-ledger-storage.ts)), so `admin` and `system` entries (e.g. the integrity override above) never surface through the operator API. New entries default to `public` ([`ledger.ts:193`](../../../packages/core/src/audit/ledger.ts), `schema.prisma:159`). Visibility plus `organizationId` together form the tenant-isolation boundary for reads.

### Trace ID correlation

**Concept.** A single user request fans out into many governance decisions, approvals, and side effects, each its own audit entry. A shared _correlation ID_ lets you reconstruct the whole story with one query, and lets you join the audit trail to HTTP request logs.

**In Switchboard.** `traceId` is nullable on `AuditEntry` ([`audit.ts:104-105`](../../../packages/schemas/src/audit.ts)), explicitly _not part of the chain hash_. `CartridgeReadAdapter.query` mints `trace_${randomUUID()}` when none is supplied ([`read-adapter.ts:42`](../../../packages/core/src/read-adapter.ts)), and it is indexed (`@@index([traceId])`) for "show me everything for this transaction" queries.

### Infrastructure failure audit recording

**Concept.** Infrastructure failures (retry exhaustion, persistence errors) must not be silent. Recording them in the same audit store as governance decisions gives post-mortems a single timeline, while alerting ensures a human is paged.

**In Switchboard.** `buildInfrastructureFailureAuditParams` ([`infrastructure-failure.ts:70-127`](../../../packages/core/src/observability/infrastructure-failure.ts)) emits one audit-entry param set plus one alert payload. **Correction to the mapping evidence:** the produced event is `eventType: "action.failed"` with `riskCategory: "high"` (not `infrastructure.job.retry_exhausted`/`critical`; that event type exists in the enum and `OPERATIONAL_AUDIT_EVENT_TYPES`, but this builder uses `action.failed`). `errorStack` and `errorName` are persisted only to the audit snapshot, kept out of the (small) alert payload. `IngressTracePersister.recordInfrastructureFailure` ([`ingress-trace-persister.ts:197-237`](../../../packages/core/src/platform/ingress-trace-persister.ts)) records the entry and fires the alert, with a hard invariant against recursive failure logging: if the audit write itself throws, it `console.error`s and moves on rather than recording a failure-of-the-failure.

### Organization-scoped credential resolution + AES-256-GCM at rest

**Concept (isolation).** The flip side of tenant-scoped _reads_ is tenant-scoped _secrets_. Each org's third-party credentials must resolve to that org's connection, and any "global" fallback must be _explicit_ (a connection with `organizationId = null`), never an accidental match against another tenant's row.

**In Switchboard.** `PrismaCredentialResolver.resolve` ([`prisma-credential-resolver.ts:38-80`](../../../packages/db/src/storage/prisma-credential-resolver.ts)) maps a cartridge to its services, tries org-scoped `getByService(serviceId, organizationId)` first, then _only_ `getByServiceGlobal(serviceId)` (which queries `organizationId = null`). A decrypt failure (missing key) is logged and skipped so the cartridge falls back to boot-time creds rather than crashing or, worse, borrowing another org's secret.

**Concept (encryption).** Stored secrets should be useless without a separate master key, tamper-evident, and resistant to rainbow tables. AES-256-GCM gives authenticated encryption (the auth tag detects modification); a per-credential random salt feeding scrypt key derivation defeats precomputation.

**In Switchboard.** `encryptCredentials` ([`credentials.ts:23-47`](../../../packages/db/src/crypto/credentials.ts)) generates a 32-byte salt and 16-byte IV, derives the key with `scryptSync(secret, salt, 32)`, encrypts with `aes-256-gcm`, and packs `salt + iv + authTag + ciphertext` to base64. `decryptCredentials` reverses it and `setAuthTag` makes a tampered ciphertext throw. The master `CREDENTIALS_ENCRYPTION_KEY` lives in env/secrets manager, so a database breach yields ciphertext only.

**Gotcha.** This key is shared identically across api/chat/dashboard/provisioning (see project memory). Rotating it is a coordinated operation: every service must agree, and existing ciphertext (salted per-credential, but derived from the same master secret) would need re-encryption. Per-credential salt protects against rainbow tables, but it does not make the master key rotatable in isolation.

### What to study next

1. **The load-bearing parenthesis** in `prisma-ledger-storage.ts:166-176`. Re-derive on paper why a flattened `AND/OR` cursor clause would leak cross-tenant rows. This is the difference between a correct and a broken multi-tenant keyset paginator.
2. **Why `traceVersionForHash` exists** in `work-trace-hash.ts`. The naming collision avoidance and the `undefined`-drop interaction with `canonicalizeSync` together are the mental model for evolving any content hash without invalidating history. Then read `work-trace-integrity.test.ts` to see the two-layer (recompute + anchor) check exercised end to end.

---

## Identity disambiguation: idempotency keys & duplicate-contact risk

This section teaches one family of data-systems problems: how a revenue-actions platform avoids doing the same thing twice, and how it spots when two database rows are secretly the same real-world person. Both problems are about _identity_. An idempotency key answers "is this the same request I already handled?" A duplicate-contact probe answers "is this contact the same human as another one?" Get either wrong and an AI agent will double-charge, double-message, or attribute revenue to a ghost.

The transferable mental model: **at every write boundary, name the unit of identity, store it as a unique constraint or a deterministic key, and make the collision case a no-op (or a flagged signal) rather than an error.** Switchboard applies this consistently, and reading the variations side by side is the fastest way to internalize the pattern.

### The P2002 "claim-first" idempotency primitive

**Concept.** A _unique constraint_ in a relational database is the cheapest possible distributed lock. If you make the database reject duplicate keys, you can let two concurrent writers race: one wins the `INSERT`, the other gets a constraint-violation error. Postgres surfaces this through Prisma as error code `P2002`. The idiom is "claim-first": try to insert; if you get `P2002`, you _lost_ the race, and you decide what that means (skip silently, or go read the existing row).

**In Switchboard.** The same duck-typed classifier appears in multiple stores, deliberately never importing a Prisma value so the check works in pure unit tests. See [`packages/core/src/skill-runtime/tools/issue-receipted-booking.ts:5`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts):

```ts
export function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
```

What the caller _does_ on `P2002` is the interesting part, and it varies by intent:

- **WorkTrace.claim()** reports the collision up as a value, not an exception. [`packages/db/src/stores/prisma-work-trace-store.ts:147-158`](packages/db/src/stores/prisma-work-trace-store.ts):

  ```ts
  } catch (err: unknown) {
    if (this.isUniqueConstraintError(err) && trace.idempotencyKey) {
      return { claimed: false };
    }
    throw err;
  }
  ```

  `{ claimed: false }` is the concurrency lock that `PlatformIngress` reads before executing domain logic: if you did not win the claim, someone else is already running this work unit, so you stop. Non-`P2002` errors propagate so the caller can retry.

- **Recommendation.insert()** swallows the throw and _reads back_ the existing row, returning an `idempotent: true` marker so the caller can tell fresh from replayed. [`packages/db/src/recommendation-store.ts:148-157`](packages/db/src/recommendation-store.ts):

  ```ts
  if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
    const existing = await this.prisma.pendingActionRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { row: rowToRecommendation(existing), idempotent: true };
  }
  ```

- **ReceiptedBooking issuance** swallows it to a pure no-op (`if (!isPrismaUniqueConstraintError(err)) throw err;` at [`issue-receipted-booking.ts:139`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts)), because the row is a derived read-model and the existing row already satisfies intent.

**How it's used at runtime.** Inbound mutating action -> `PlatformIngress.submit()` -> `WorkTraceStore.claim(trace)` inserts a `running` trace keyed by `(organizationId, idempotencyKey)` in the same `$transaction` as the audit-ledger record. If the claim returns `claimed: false`, ingress short-circuits; otherwise it proceeds to governance and domain execution.

**Gotchas.** (1) `claim()` does _not_ inspect `err.meta.target` to confirm _which_ unique constraint fired. The comment at [`prisma-work-trace-store.ts:148-153`](packages/db/src/stores/prisma-work-trace-store.ts) argues this is safe-by-construction: `workUnitId` is a fresh per-submit cuid, so a primary-key collision is unreachable, and failing closed on the unlikely case never causes a double-apply. (2) Under Postgres a thrown statement aborts the _whole_ transaction, so a swallow-and-continue inside a `$transaction` cannot truly isolate one failing write. That is why ReceiptedBooking is made "infallible by construction" instead (see below) rather than relying on the swallow.

### WorkTrace idempotency is org-scoped

**Concept.** An idempotency key only means something within a _namespace_. If your key space is global, tenant A's request can collide with tenant B's and silently drop a legitimate write. Scoping the unique constraint to `(organizationId, key)` makes replay protection per-tenant.

**In Switchboard.** The `WorkTrace` unique constraint is `(organizationId, idempotencyKey)`, and `claim()` (above) is the producer. This is the canonical "D1 idempotency" primitive in the doctrine: claim-first insert _before_ the domain mutation, with the audit-ledger row written in the same transaction so the proof-of-work and the work cannot diverge. The key data-flow insight is that the WorkTrace is written _first_ and acts as the lock, not as an after-the-fact log.

**How it's used at runtime.** Same path as above. The org-scoping prevents cross-tenant replay; the in-transaction audit record means an aborted claim leaves no orphan ledger entry.

### Orchestrator-level idempotency fingerprinting

**Concept.** Database unique constraints protect _writes_. But you may want to dedup _before_ you even spend compute, for example to avoid re-running an expensive LLM governance evaluation for an identical request. The classic tool is a content fingerprint: hash the meaningful inputs into a deterministic key, cache the response under it with a TTL.

**In Switchboard.** `IdempotencyGuard` operates at the `propose()` layer, explicitly separate from the HTTP-level middleware. [`packages/core/src/idempotency/guard.ts:60-70`](packages/core/src/idempotency/guard.ts):

```ts
static generateKey(principalId, actionType, parameters) {
  const hash = createHash("sha256");
  hash.update(principalId);
  hash.update(actionType);
  hash.update(JSON.stringify(parameters, Object.keys(parameters).sort()));
  return hash.digest("hex");
}
```

The `Object.keys(parameters).sort()` is load-bearing: `JSON.stringify`'s second argument is a key _allowlist_, and passing the sorted keys forces deterministic field ordering so `{a,b}` and `{b,a}` hash identically. The store is pluggable (in-memory `Map` or Prisma-backed) with a default 5-minute TTL.

**How it's used at runtime.** Before governance evaluation, `checkDuplicate()` probes the store; on a hit it returns the cached response and skips re-evaluation. `recordResponse()` caches after the fact.

**Gotchas.** This is _distinct_ from WorkTrace idempotency. WorkTrace's unique constraint is durable and org-scoped; the guard's hash is ephemeral (TTL-windowed) and protects governance compute, not domain writes. Conflating them leads to thinking replay protection is weaker than it is.

### Day-bucketed dedupe keys for scheduled sends

**Concept.** Cron jobs retry. If a follow-up cron fires twice in a day, you must not send two messages. But you also do not want a key so strict that a legitimately-rescheduled touch is suppressed forever. The answer is a _bucketed_ deterministic key: coarse enough to absorb retries, granular enough to allow the next real touch.

**In Switchboard.** [`packages/schemas/src/scheduled-follow-up.ts:64-72`](packages/schemas/src/scheduled-follow-up.ts):

```ts
export function buildFollowUpDedupeKey(organizationId, contactId, dueAt, touchNumber): string {
  const dayBucket = dueAt.toISOString().slice(0, 10); // YYYY-MM-DD
  return `followup:${organizationId}:${contactId}:${dayBucket}:t${touchNumber}`;
}
```

The `:t${touchNumber}` suffix keeps two touches landing on the same calendar day collision-proof; the day bucket absorbs intra-day cron retries. `ScheduledFollowUpStore`, `ScheduledReminderStore`, and `RobinRecoverySendStore` each enforce `dedupeKey` unique, and the executor swallows `P2002` to skip. The cadence builder is send-relative: [`packages/core/src/scheduled-follow-up/cadence.ts:28`](packages/core/src/scheduled-follow-up/cadence.ts) anchors the next touch on `now` so a delayed send _stretches_ the cadence rather than compressing it.

**Gotchas.** The bucket granularity _is_ the policy. A one-day bucket means at most one send per contact per touch per day. Study `ACTIVATION_SKIP_REASONS` in the same file: a skipped touch (for example `template_not_approved`) is retried on an activation interval rather than terminated, so "idempotent skip" and "permanent terminate" are different outcomes you must not collapse.

### phoneE164 as the canonical identity disambiguator

**Concept.** To detect that two records are the same person you need a _stable, normalized_ identity column. Raw phone strings ("(415) 555-1234" vs "+14155551234") will never match by equality. E.164 is the international normalized form; normalizing on write makes exact-equality matching reliable.

**In Switchboard.** `PrismaContactStore.create()` normalizes on every insert at [`packages/db/src/stores/prisma-contact-store.ts:90`](packages/db/src/stores/prisma-contact-store.ts): `const phoneE164 = normalizeToE164(input.phone ?? null);`. The same normalization happens in the lead-intake upsert, so `phoneE164` is single-source-of-truth for phone identity regardless of input format (US +1, SG +65, etc.).

**How it's used at runtime.** Contact upsert (intake or manual) -> `normalizeToE164` -> persisted `phoneE164`. Booking issuance later reads this column to probe for duplicates (next concept).

### duplicate_contact_risk detection at issuance

**Concept.** Identity ambiguity should be detected _once_, at the moment a fact is committed, and then carried as durable state. Re-deriving it on every read is both an N+1 performance trap and, worse, it would silently re-open an issue a human already resolved. This is the difference between an _event_ (detected once) and a _recomputed projection_ (re-derived each read).

**In Switchboard.** Inside the booking transaction, after reading the evidence contact, [`issue-receipted-booking.ts:102-114`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts):

```ts
const rawPhoneE164 = evidenceContact?.phoneE164 ?? null;
let duplicateContactRisk = false;
if (rawPhoneE164 && rawPhoneE164.trim().length > 0) {
  const otherWithSamePhone = await tx.contact.findFirst({
    where: {
      organizationId: args.organizationId,
      phoneE164: rawPhoneE164,
      id: { not: args.contactId },
    },
    select: { id: true },
  });
  duplicateContactRisk = otherWithSamePhone !== null;
}
```

The probe is org-scoped exact equality, excludes self (`id: { not }`), and skips entirely when the key is null/empty/whitespace (an empty phone carries no dedup identity). The boolean flows into `buildReceiptedBookingData`, and the pure `evaluateExceptions` turns it into a persisted exception entry at [`packages/core/src/receipts/evaluate-exceptions.ts:44-46`](packages/core/src/receipts/evaluate-exceptions.ts):

```ts
if (ctx.duplicateContactRisk) {
  entries.push({ code: "duplicate_contact_risk", raisedAt: ctx.now });
}
```

The doctrine comment at lines 95-101 is the lesson: detecting at issuance (not in `getView`) avoids re-opening operator-resolved duplicates and avoids an N+1 probe across `listForCohort`.

**Gotchas.** ReceiptedBooking is a _derived read-model_ (Doctrine #3), so it must never fail the canonical booking. The mitigation is "infallible by construction" ([`issue-receipted-booking.ts:56-64`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts)): the payload is fully JSON-serializable (no `Date` in the exceptions Json), every column is set, and the `unique(bookingId)` collision is unreachable because the booking id is freshly minted and `findFirst`-guarded.

### Append-only exception merge semantics

**Concept.** When you re-evaluate a derived state, you must reconcile the _freshly computed desired set_ against _persisted history_ without destroying resolutions a human made. The pattern is an append-only merge scoped to the codes this write actually owns.

**In Switchboard.** `mergeExceptions(prior, desired, now, governedCodes)` at [`packages/core/src/receipts/merge-exceptions.ts:20-62`](packages/core/src/receipts/merge-exceptions.ts) implements three rules: governed-and-desired-open with a prior open entry keeps the prior untouched (preserving `raisedAt`); governed-desired-open with no prior appends fresh; governed prior-open no-longer-desired gets `resolvedAt` stamped. Non-governed codes and resolved history pass through verbatim, guaranteeing at most one open entry per code. It is JSON-native (ISO strings, never `Date`) so the Prisma `Json` write cannot fail. The consumer scopes the governed set tightly at [`packages/db/src/stores/prisma-receipted-booking-store.ts:413-417`](packages/db/src/stores/prisma-receipted-booking-store.ts) to `new Set(["duplicate_contact_risk"])`, and `RESOLVABLE_CODES` (line 36) gates which codes a `resolve_exception` may stamp.

**Gotchas.** The `governedCodes` scope is the safety boundary: a `flag_duplicate` write must not accidentally resolve an unrelated open `missing_consent`. Study why only `duplicate_contact_risk` is resolvable in v1, and how `unsupported_code` is returned for anything else.

### Two-stage outcome-pattern dedup (DeploymentMemory)

**Concept.** When an LLM extracts labels, the same idea recurs with different wording and sometimes different categories. You want to merge near-duplicates _within_ a category and _detect_ (not silently merge) collisions _across_ categories, because a cross-category collision is a signal that your enum or your prompt is wrong.

**In Switchboard.** `trackPattern()` at [`packages/core/src/memory/compounding-service.ts:449-510`](packages/core/src/memory/compounding-service.ts) runs stage 1 within the same `canonicalKey` bucket, merging when cosine similarity clears `OUTCOME_PATTERN_MERGE_THRESHOLD` (incrementing confidence instead of creating). On a stage-1 miss it scans the broad category and, on a `>= 0.92` match with a _different_ canonicalKey, increments `outcomePatternsCrossKeyCollision` without merging:

```ts
if (similarity >= SIMILARITY_THRESHOLD /* legacy 0.92 */) {
  metrics.outcomePatternsCrossKeyCollision.inc({
    deploymentId,
    currentKey: canonicalKey,
    collidingKey: entryCanonicalKey,
  });
  break;
}
```

Identity is enforced underneath by the `DeploymentMemory` unique constraint on `(org, deployment, category, content)`, so a final `create()` that races resolves via `P2002`.

**Gotchas.** The cross-key collision is a _quality metric_, not an auto-merge. It tells operators the LLM is conflating distinct operational categories. Counting it separately from `outcomePatternsMerged` is what makes that signal legible.

### canonicalKey validation and enumeration scoping

**Concept.** LLM-produced category slugs must be validated on two axes before they become durable identity: _syntactic_ (well-formed slug) and _semantic_ (a known category). Separating these gives you actionable metrics: a malformed slug is a prompt bug; a well-formed-but-unknown slug is an enum-coverage gap.

**In Switchboard.** `processOutcomePatterns` at [`compounding-service.ts:268-284`](packages/core/src/memory/compounding-service.ts) checks structure first via `CANONICAL_KEY_PATTERN` ([`packages/schemas/src/canonical-keys.ts:11`](packages/schemas/src/canonical-keys.ts): `/^[a-z_]+:[a-z0-9_]+$/`, the `namespace:key` form), incrementing `invalid_canonical_key`; then `isKnownCanonicalKey(key, enumeration)` against the deployment enum, incrementing `unknown_canonical_key`. v1 uses the medspa enumeration; vertical config is deferred. A bare `unknown` slug fails the pattern because it has no colon, so degenerate LLM output is rejected without blocking the compounding flow.

**Gotchas.** Order matters: structural rejection comes first so the two failure metrics never overlap. This is graceful degradation, an unexpected category is dropped, not thrown, so one bad extraction never poisons a conversation's whole pattern set.

---

## Freshness: decay windows, recency signals, TTL caches

Every autonomous revenue-actions platform is, underneath, a system that reasons over data that is constantly going stale. A conversation pattern learned six months ago, a pixel that fired this morning but not since, an operator who confirmed business hours two weeks ago, a spend total computed three seconds ago: each carries an implicit "as of" timestamp, and the correctness of a downstream decision depends on whether the platform treats that timestamp honestly.

This section teaches the three closely related techniques Switchboard uses to manage data age:

- **Decay windows** gradually reduce the _weight_ of old data (confidence scores ramp down over time).
- **Recency signals / freshness gates** make a binary or categorical judgment about whether data is recent enough to act on (fresh / stale / dead).
- **TTL caches** (time-to-live) hold expensive-to-compute values for a bounded window, trading a little staleness for a lot less load.

The unifying idea is the same in all three: read a timestamp, compute an age (`now - then`), and compare it to a window. The interesting engineering lives in _what you do at the boundary_ and _what failure looks like when the timestamp is missing_. Watch for those two themes throughout.

A transferable mental model: a TTL cache is a decay window with a step function (weight 1.0 inside the window, 0.0 outside), and a freshness gate is a TTL cache where the "value" is the data's own usability. They are the same primitive tuned for different jobs.

---

### Pattern Confidence Decay Window (learned-memory aging)

**Concept.** When an AI agent learns from past conversations, it accumulates "patterns" with confidence scores. Old patterns should not vanish (they may still be true), but they should weigh less than fresh evidence. The standard technique is _confidence decay_: on a schedule, subtract a small amount from the confidence of any pattern that has not been re-observed recently, with a floor so nothing decays to zero.

**In Switchboard.** The window is a schema constant; the schedule is an Inngest cron; the actual mutation is a single `updateMany` in the store.

[`packages/schemas/src/deployment-memory.ts:91-92`](packages/schemas/src/deployment-memory.ts)

```ts
export const DECAY_WINDOW_DAYS = 90;
export const PATTERN_DECAY_WINDOW_DAYS = 180;
```

The daily cron (`0 7 * * *`) wires the constants into the job at [`apps/api/src/bootstrap/inngest.ts:644-646`](apps/api/src/bootstrap/inngest.ts) (`windowDays: PATTERN_DECAY_WINDOW_DAYS, decayAmount: 0.1, floor: 0.3`) and registers `dailyPatternDecayCron` (lines 701-723). The producer computes the cutoff at [`packages/core/src/memory/inngest-functions.ts:42-53`](packages/core/src/memory/inngest-functions.ts):

```ts
const now = deps.now();
const startOfDay = startOfUtcDay(now);
const cutoffDate = new Date(now.getTime() - deps.windowDays * MS_PER_DAY);
const decayedCount = await step.run("decay-stale-patterns", () =>
  deps.memoryStore.decayStale({
    cutoffDate,
    decayAmount: deps.decayAmount,
    floor: deps.floor,
    startOfDay,
  }),
);
```

The enforcer is the store at [`packages/db/src/stores/prisma-deployment-memory-store.ts:116-135`](packages/db/src/stores/prisma-deployment-memory-store.ts):

```ts
const result = await this.prisma.deploymentMemory.updateMany({
  where: {
    lastSeenAt: { lt: input.cutoffDate },
    confidence: { gt: input.floor },
    OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: input.startOfDay } }],
  },
  data: { confidence: { decrement: input.decayAmount }, lastDecayedAt: new Date() },
});
return result.count;
```

**How it's used at runtime.** Inngest fires at 07:00 UTC daily, the job computes `cutoffDate = now - 180d`, and the store decrements confidence by 0.1 for every memory row last seen before the cutoff that is still above the 0.3 floor. The returned count feeds a Prometheus-style counter (`outcomePatternsDecayed`). When an agent later scores its memory for surfacing to a customer, the decayed confidence is what gets compared against `SURFACING_THRESHOLD` (`minConfidence: 0.66`, line 85), so decay directly throttles which learned patterns are allowed to influence replies.

**Gotchas / what to study next.** (1) The `OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: startOfDay } }]` clause is an _idempotency guard against double-decay within one day_. Because the job is a `set`-style `updateMany` rather than read-modify-write, re-running the cron (Inngest retries, manual replay) would otherwise decay the same row twice. `startOfDay` is UTC-floored, so the guard is "once per UTC calendar day," not "once per 24h." (2) Decay is deliberately a single global `updateMany` with no `organizationId` filter (the comment marks it `store-mutation-global`); this is a cross-tenant batch, which is why the metric only emits aggregate labels and never a `deploymentId`. Study why a learning-memory decay can safely be global while almost every other write in this codebase is org-scoped.

---

### Operational State Freshness Window (operator attestation aging)

**Concept.** Some data can only be vouched for by a human ("our hours are still 9-6, pricing unchanged"). An _attestation of normalcy_ is only trustworthy for a bounded time. This is a freshness gate over a human confirmation timestamp, not over machine data.

**In Switchboard.** The window is 14 days, chosen to equal two weekly-audit cycles. [`packages/schemas/src/operational-state-policy.ts:30-33`](packages/schemas/src/operational-state-policy.ts):

```ts
export const OPERATIONAL_STATE_VOUCH_DAYS = 14;
export const OPERATIONAL_STATE_VOUCH_MS = OPERATIONAL_STATE_VOUCH_DAYS * 24 * 60 * 60 * 1000;
```

The derivation is a three-valued function at [`packages/ad-optimizer/src/revenue-state.ts:111-119`](packages/ad-optimizer/src/revenue-state.ts):

```ts
export function deriveBusinessContextFreshness(
  latest: { confirmedAt: Date } | null,
  now: Date,
): BusinessContextFreshness {
  if (latest === null) return "unknown";
  return now.getTime() - latest.confirmedAt.getTime() <= OPERATIONAL_STATE_VOUCH_MS
    ? "fresh"
    : "stale";
}
```

**How it's used at runtime.** During Riley's weekly ad-optimization audit, `RevenueState` assembly resolves the operator's latest "everything still accurate" confirmation and calls `deriveBusinessContextFreshness`. A `stale` or `unknown` result downshifts recommendations to advisory-only rather than auto-executable: the agent will not pause a campaign on the strength of a two-week-old picture of the business.

**Gotchas / what to study next.** Note the boundary semantics encoded in the comment and the `<=`: a confirmation made _exactly_ 14 days ago still counts as fresh, and a future-dated `confirmedAt` (clock skew) is treated as fresh, never stale. This is a deliberate "fail-toward-trusting-the-human" boundary. Contrast it with the next concept, where the boundary fails _toward distrust_.

---

### Signal Health Freshness Threshold and Pixel Dead Age (machine-signal recency)

**Concept.** Tracking infrastructure (Meta pixel + Conversions API server events) is the platform's eyes. If events stop arriving, every downstream metric silently lies. Two recency checks guard this: a soft "freshness" check (events should be < 1 hour old) and a hard "dead" check (a pixel that has not fired in 24 hours is broken, not slow).

**In Switchboard.** Both thresholds are constants in [`packages/ad-optimizer/src/signal-health-checker.ts:12-13`](packages/ad-optimizer/src/signal-health-checker.ts):

```ts
const PIXEL_DEAD_AGE_MS = 24 * 60 * 60_000;
const FRESHNESS_THRESHOLD_MS = 60 * 60_000;
```

The CAPI freshness producer (lines 238-240):

```ts
const freshnessMs = latestServerTimestampMs === null ? Infinity : now - latestServerTimestampMs;
const isFresh = latestServerTimestampMs !== null && freshnessMs < FRESHNESS_THRESHOLD_MS;
```

The dead-pixel enforcer (lines 313-319):

```ts
function computeIsDead(lastFiredAt: string | null, isUnavailable: boolean, nowMs: number): boolean {
  if (isUnavailable) return true;
  if (!lastFiredAt) return true;
  const ts = Date.parse(lastFiredAt);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts > PIXEL_DEAD_AGE_MS;
}
```

**How it's used at runtime.** The weekly signal-health audit pulls `last_event_time` (CAPI stats) and `last_fired_time` (pixel metadata) from the Meta Graph API, computes the two ages, and emits breach records: `freshness_stale` (CAPI > 1h) feeds a `fix_signal_health` recommendation, and a dead pixel produces a critical `pixel_dead` breach. These run _before_ Riley's decision layer so the operator is told "your tracking is broken" rather than the agent silently optimizing against phantom conversions.

**Gotchas / what to study next.** Both functions encode a "missing means broken" stance: a `null` timestamp produces `freshnessMs = Infinity` / `isFresh = false`, and `computeIsDead` returns `true` for null, unavailable, _and_ unparseable timestamps. This is the opposite boundary from the operator-attestation gate above, and it is correct: absent human attestation means "ask again" (`unknown`), but absent machine signal means "assume the worst." Internalize that the right default for a missing timestamp is domain-specific, not universal. Also note `60 * 60_000` uses a numeric separator on the milliseconds operand, a small readability habit worth copying.

---

### Attribution Window (causal recency, kind-specific)

**Concept.** To learn whether an action _worked_, you measure outcomes in a window around it. Too short and slow-moving metrics never settle; too long and unrelated effects leak in. Different action types need different windows.

**In Switchboard.** Per-kind windows live at [`packages/core/src/recommendations/outcome-attribution-config.ts:1-23`](packages/core/src/recommendations/outcome-attribution-config.ts): `SETTLEMENT_LAG_HOURS = 24`, `pause` uses `windowDays: 7`, `refresh_creative` uses `windowDays: 14`. The producer builds a symmetric interval around the action at [`packages/core/src/recommendations/outcome-attribution.ts:50-53`](packages/core/src/recommendations/outcome-attribution.ts):

```ts
const windowDays = config.windowDays;
const anchorAt = candidate.resolvedAt;
const windowStartedAt = new Date(anchorAt.getTime() - windowDays * MS_PER_DAY);
const windowEndedAt = new Date(anchorAt.getTime() + windowDays * MS_PER_DAY);
```

**How it's used at runtime.** When a recommendation resolves, attribution reads pre-window and post-window Meta metrics, and the 24h settlement lag guarantees the post-window has closed (Meta's numbers stop moving) before the read. A pause is judged on a 7-day spend swing; a creative refresh on a 14-day CTR swing.

**Gotchas / what to study next.** The window is _anchored on the action timestamp_ (`resolvedAt`), not on "now," so attribution is a backward-looking causal window, not a freshness gate. Sparse-data protection (line 58, `sparseThreshold = ceil(windowDays * 0.5)`) flags windows with too few daily rows. Study how settlement lag (a deliberate _delay_ before reading) interacts with the window: freshness usually means "act on the newest data," but here correctness requires _waiting_ for data to age into stability.

---

### Substantiation Staleness Window (compliance-evidence aging)

**Concept.** Regulated claims (medical efficacy, safety) need _recent_ approved evidence. Old approvals may no longer reflect current regulation, so a compliance resolver must reject substantiation that is too old.

**In Switchboard.** [`packages/core/src/governance/classifier/substantiation-resolver.ts:14`](packages/core/src/governance/classifier/substantiation-resolver.ts) defines `STALENESS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000`. The staleness check (lines 116-120) is a _dual_ gate the mapping missed:

```ts
function isStale(claim: ApprovedComplianceClaimRecord, now: Date): boolean {
  if (claim.validUntil && new Date(claim.validUntil).getTime() < now.getTime()) return true;
  if (new Date(claim.reviewedAt).getTime() < now.getTime() - STALENESS_WINDOW_MS) return true;
  return false;
}
```

**How it's used at runtime.** When the governance classifier finds a claim-bearing sentence in agent output, it resolves substantiation against `approved_compliance_claim` records. A claim is rejected as evidence if it has an explicit `validUntil` in the past _or_ was reviewed more than 180 days ago. Only fresh, approved claims clear the gate.

**Gotchas / what to study next.** Two staleness paths coexist: an explicit per-claim expiry (`validUntil`) and an implicit global 180-day window from `reviewedAt`. The explicit one wins when present and can be _shorter_. Whenever you see a "default window plus optional override," check which direction the override is allowed to move the boundary; here it can only tighten, never extend.

---

### In-memory TTL caches: Policy, Spend, Composite Risk, Idempotency, Guardrail State

**Concept.** A TTL cache stores a computed value with an `expiresAt` and serves it until that timestamp passes. It trades bounded staleness for fewer recomputations. Switchboard uses the same `{ value, expiresAt }` shape in five hot paths, all checking `Date.now() > expiresAt` and lazily deleting expired entries on read.

**In Switchboard.**

- **Policy cache**, 60s, [`packages/core/src/policy-cache.ts:3,42,58`](packages/core/src/policy-cache.ts): `get()` deletes and returns `null` past `expiresAt`; `set()` stores `expiresAt = Date.now() + ttlMs`.
- **Spend lookup**, 10s, [`packages/core/src/orchestrator/propose-helpers.ts:89-148`](packages/core/src/orchestrator/propose-helpers.ts): caches daily/weekly/monthly spend aggregated from a 500-envelope scan, keyed by `principalId:organizationId`.
- **Composite risk**, 10s, same file lines 152-195: scans the last 60 minutes of envelopes (200 limit) for correlated high-risk actions.
- **Idempotency guard**, 5min, [`packages/core/src/idempotency/guard.ts:23-54`](packages/core/src/idempotency/guard.ts): key = `sha256(principalId + actionType + sorted JSON params)`.
- **Guardrail state**, configurable TTL, [`packages/core/src/guardrail-state/in-memory.ts:8-49`](packages/core/src/guardrail-state/in-memory.ts): rate-limit counters and cooldowns.

The spend cache shows the canonical read/refresh pattern:

```ts
const cached = spendCache.get(cacheKey);
if (cached && now < cached.expiresAt) return cached.value;
// ... expensive scan ...
spendCache.set(cacheKey, { value: result, expiresAt: now + SPEND_CACHE_TTL_MS });
```

**How it's used at runtime.** During a `propose()` burst (an agent submitting several actions in quick succession), the governance layer needs spend aggregates and composite-risk context for each proposal. Without caching, that is N full envelope scans per burst; the 10s TTL collapses them to one scan plus N cheap map reads, while still re-scanning often enough to catch a _new_ high-risk action within ten seconds. The policy cache similarly short-circuits repeated DB policy lookups, and the idempotency guard returns the cached governance response when an identical request re-arrives within five minutes.

**Gotchas / what to study next.** (1) These are _module-level_ `Map`s (`const spendCache = new Map(...)`), so they are per-process, not shared across the API/chat/dashboard processes. There is an exported `clearProposeCaches()` purely so tests can reset global state; that escape hatch is a tell that the cache is process-global. (2) The 10s window is a deliberate _safety-vs-load_ tradeoff: a freshly executed high-spend action can be invisible to the spend gate for up to 10 seconds. Study whether that window is acceptable for your SLA, and note that the idempotency guard's 5-minute window is much longer because re-arriving _identical_ requests within minutes are almost always retries, not legitimate distinct actions.

---

### Approval TTL and expiry-driven urgency (TTL that creates pressure)

**Concept.** A pending human approval should not block work forever. A TTL here does double duty: it expires stale approvals _and_ its remaining time drives an urgency score that surfaces the most time-critical decisions first.

**In Switchboard.** `DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000` at [`packages/core/src/workflows/workflow-engine.ts:23`](packages/core/src/workflows/workflow-engine.ts). `createApprovalCheckpoint` stamps `expiresAt = now + ttlMs` ([`approval-checkpoint.ts:35`](packages/core/src/workflows/approval-checkpoint.ts)). The enforcer is trivially `checkExpiry` ([`packages/core/src/approval/expiry.ts:3-5`](packages/core/src/approval/expiry.ts), `status === "pending" && now > expiresAt`). The interesting consumer is urgency scoring at [`packages/core/src/decisions/urgency.ts:47-53`](packages/core/src/decisions/urgency.ts):

```ts
const hoursUntilExpiry = (row.expiresAt.getTime() - nowMs) / 3_600_000;
if (hoursUntilExpiry <= 0) return 100;
if (hoursUntilExpiry >= 24) return floor;
return Math.round(100 - (hoursUntilExpiry / 24) * (100 - floor));
```

**How it's used at runtime.** A parked approval starts at a risk-based floor (45-70) and its score ramps linearly to 100 as expiry approaches; `decisionSortComparator` then sorts the operator's queue by score descending, so the closest-to-expiry, highest-risk items float to the top.

**Gotchas / what to study next.** The same `expiresAt` field is read by two unrelated consumers (expiry boolean and urgency ramp). When you change the TTL, you change _both_ behaviors. Note also that this TTL is `expiresAt`-persisted on a row, unlike the in-memory caches above; it survives restarts and is the same modeling choice as the report cache below.

---

### Persisted cache freshness: Report cache (caller-checks-freshness)

**Concept.** Expensive reports (funnel rollups, attribution) are cached in the database with `computedAt`/`expiresAt`. A key design choice: should the _store_ hide stale rows, or return them and let the _caller_ decide?

**In Switchboard.** The interface deliberately returns stale rows. [`packages/core/src/reports/interfaces.ts:18-19`](packages/core/src/reports/interfaces.ts) documents `findByKey` as "Returns the row if present (regardless of freshness)." The Prisma store ([`packages/db/src/stores/prisma-report-cache-store.ts:8-44`](packages/db/src/stores/prisma-report-cache-store.ts)) just reads and maps the row. The freshness decision lives in the consumer at [`apps/api/src/routes/dashboard-reports.ts:150-152`](apps/api/src/routes/dashboard-reports.ts):

```ts
const cached = await app.reportCacheStore.findByKey(orgId, reportWindow);
if (cached && cached.expiresAt > new Date()) {
  return cached.payload;
}
```

On miss or stale, the route recomputes and `upsert`s with `expiresAt = now + CACHE_TTL_MS` (1 hour, line 22/104-109). A `/refresh` route force-invalidates via `invalidate(orgId, window)`.

**How it's used at runtime.** A dashboard report request hits the route, which checks the cache, serves it if `expiresAt` is in the future, otherwise rolls up fresh data and re-caches. This prevents recompute storms when many dashboard tiles request the same window at once.

**Gotchas / what to study next.** The "store returns stale, caller checks freshness" split is a real design lever: it lets one caller serve a slightly-stale row deliberately (graceful degradation) while another insists on freshness, without two store methods. Compare this to the policy cache, where the _store_ enforces TTL and never hands back an expired entry. Both are valid; know which contract you are holding.

---

### Recency filters and time-decay on reads: Contact pipeline, Activity status, Lead intake

**Concept.** Not all freshness is a cache. Sometimes "recent" is just a query filter or a derived status. These are read-time recency signals.

**In Switchboard.**

- **Contact recency filter**, [`packages/db/src/stores/prisma-contact-store.ts:302-320`](packages/db/src/stores/prisma-contact-store.ts): `listForPipeline` filters `lastActivityAt >= activitySince`, orders `DESC`, and returns `{ rows, totalCount }` (a separate `count()`) so the UI badge reflects the true total even when `take` caps the rows.
- **Activity status time decay**, `ACTIVITY_STATUS_STALE_MS = 10 * 60_000` at [`packages/db/src/storage/agent-state-deriver.ts:40,54-64`](packages/db/src/storage/agent-state-deriver.ts): a transient `working`/`analyzing` status decays to `idle` once `now - lastActionAt > 10min`, but non-transient states (`waiting_approval`, `error`) pass through unchanged.
- **Lead intake recency**, [`packages/db/src/stores/lead-intake-store.ts:138-141`](packages/db/src/stores/lead-intake-store.ts): `hasRecentLead(orgId, sourceType, days)` counts contacts with `createdAt >= now - days*24h`, returning a boolean for Gate-0 intake routing.

The activity decay is the subtle one:

```ts
if (!TRANSIENT_STATUSES.has(status)) return status;
if (!lastActionAt) return "idle";
const elapsed = now.getTime() - lastActionAt.getTime();
if (!Number.isFinite(elapsed) || elapsed > ACTIVITY_STATUS_STALE_MS) return "idle";
return status;
```

**How it's used at runtime.** The agent-home UI derives each agent's live status from its event log; a stuck `working` claim from 11 minutes ago decays to `idle`, while a real `waiting_approval` persists, so an operator sees who is genuinely blocked versus merely dormant. The contact pipeline tile shows only recently-active contacts, newest first. Lead-intake Gate-0 checks per-source recency (e.g. ctwa 7d, instant_form 14d) before triggering intake workflows.

**Gotchas / what to study next.** The `!Number.isFinite(elapsed)` guard is load-bearing and reflects a repo-wide lesson: a raw `elapsed > stale` comparison is `false` for `NaN`, so a missing or invalid timestamp would _silently read as fresh_. Decaying-to-idle on non-finite age is the safe default. This is the same NaN-blind-comparison hazard that appears in the signal-health and OAuth checks below; once you see it, you will start guarding every external-timestamp comparison with `Number.isFinite`.

---

### OAuth state freshness (security replay window)

**Concept.** A freshness window can be a _security_ control: a signed, timestamped token that is only valid for a short window defeats replay attacks.

**In Switchboard.** `STATE_MAX_AGE_MS = 10 * 60 * 1000` at [`packages/ad-optimizer/src/facebook-oauth.ts:30`](packages/ad-optimizer/src/facebook-oauth.ts). `buildSignedState` embeds an issued-at into an HMAC-signed payload; `verifySignedState` (lines 58-85) recomputes the HMAC, constant-time-compares, then enforces the window:

```ts
const issuedAt = parseInt(payload.slice(sep + 1), 36);
if (!Number.isFinite(issuedAt)) return null;
const age = Date.now() - issuedAt;
if (age < 0 || age > maxAgeMs) return null;
```

**How it's used at runtime.** When an operator clicks "connect Facebook," the API signs a `state` bound to the `deploymentId` and the current time. On callback, `verifySignedState` rejects the request if the signature fails, the timestamp is unparseable, the age is negative (future-dated), or older than 10 minutes. Only then does the callback trust the embedded `deploymentId` without a Bearer token.

**Gotchas / what to study next.** Three things make this a security window rather than a convenience cache: the value is _signed_ (tampering is detected before the age check), `age < 0` is rejected (a future timestamp is suspicious, not lenient, unlike the operator-attestation gate), and the comparison is again `Number.isFinite`-guarded. Study the ordering: signature verification happens _before_ the freshness check, so an attacker cannot even reach the age logic with a forged timestamp. Freshness is the last gate, not the first.

---

## Consent boundaries, PDPA & jurisdiction gating

This pillar is about a regulated truth: an AI that messages real people in Singapore (SG) and Malaysia (MY) is processing personal data under each country's **PDPA** (Personal Data Protection Act). For an AI revenue-actions platform, "send a follow-up", "book an appointment", and "show the AI disclosure" are not free actions; they are governed by a per-contact consent lifecycle that must be auditable. Switchboard models that lifecycle as a small set of immutable-once-set fields on `Contact`, a service that mutates them under invariants, and a layered set of gates that read them at the exact moments an action would touch a customer. A recurring design idea you should extract: **stored data is not enforced data**, and **enforcement is staged behind a three-mode switch** so PDPA can be turned on without surprise blocking in production.

Throughout, "jurisdiction" means the regulatory regime (SG or MY); "consent" means a data subject's grant/revocation tracked against that regime; and "disclosure" means the transparency text telling the customer they are talking to an AI.

### Jurisdiction-scoped, immutable PDPA consent state

**Concept.** When the same logical entity (a contact) can fall under multiple legal regimes, you must bind its consent record to exactly one regime and refuse to silently move it. Otherwise a grant captured under one law gets reused under another, which is both a compliance defect and an audit nightmare. The transferable pattern is **write-once immutability enforced at two layers** (application invariant + database WHERE clause).

**In Switchboard.** The state lives as nullable columns on `Contact` in [`packages/db/prisma/schema.prisma:1817`](packages/db/prisma/schema.prisma#L1817). The schema comment itself encodes the invariant:

```prisma
// pdpaJurisdiction is immutable after first non-null write in v1, only
// ConsentService mutates these; service throws ConsentJurisdictionMismatch
pdpaJurisdiction         String?
consentGrantedAt         DateTime?
consentRevokedAt         DateTime?
aiDisclosureVersionShown String?
```

The application invariant lives in `ConsentService.ensureJurisdictionStamped` at [`packages/core/src/consent/consent-service.ts:108`](packages/core/src/consent/consent-service.ts#L108): it reads the current jurisdiction, no-ops if it already matches, and throws `ConsentJurisdictionMismatch` if a _different_ jurisdiction is already stamped. The database layer is the second line: `setJurisdictionIfNull` ([`packages/db/src/prisma-consent-store.ts:60`](packages/db/src/prisma-consent-store.ts#L60)) uses a conditional `updateMany`:

```ts
await prisma.contact.updateMany({
  where: { id: contactId, organizationId, pdpaJurisdiction: null },
  data: { pdpaJurisdiction: jurisdiction },
});
```

A row whose `pdpaJurisdiction` is already set matches zero rows, so the stamp is a no-op at the SQL level even if the service check were bypassed.

**How it's used at runtime.** During an inbound turn, `PdpaConsentGateHook.afterSkill` calls `attachToGovernedInteraction(contactId, config.jurisdiction, orgId)` ([`pdpa-consent-gate.ts:89`](packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts#L89)). The deployment's configured jurisdiction is the source of truth; the first governed interaction stamps it, and every later interaction confirms it matches.

**Gotchas / what to study next.** The producer (service check) and the database constraint protect _different_ failure modes: the service catches an operator passing the wrong jurisdiction; the WHERE clause catches a TOCTOU race or a path that skips the service. Note also that re-granting after revocation is deliberately impossible (`recordGrant` throws `ConsentRevokedCannotRegrant`); a fresh cycle requires an explicit `clearConsent`, which a human (not a `system:` actor) must perform.

### Three-mode enforcement: off / observe / enforce

**Concept.** Shipping enforcement logic and _activating_ it are separate risks. The safe rollout pattern is a per-tenant mode switch with three states: `off` (zero-overhead pass-through), `observe` (run the full logic, emit telemetry, change nothing customer-visible), and `enforce` (actually block). `observe` gives you production parity data ("what _would_ enforce have blocked?") before flipping the live behavior.

**In Switchboard.** `ConsentStateConfigSchema` and its resolver live in [`packages/schemas/src/governance-config.ts:76`](packages/schemas/src/governance-config.ts#L76). The mode lives under `governanceConfig.consentState.mode`, defaulting to `off`. Crucially, the resolver **fail-safes corrupt config to `off`** and logs only the Zod issue path/code (never the raw value, to avoid echoing stored input):

```ts
const parsed = ConsentStateConfigSchema.safeParse(raw ?? {});
if (!parsed.success) {
  console.error(
    "[governance-config] corrupt consentState sub-block; failing open to mode=off ...",
    { issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
  );
  return { mode: "off" };
}
```

Every gate consumes this resolver and short-circuits on `off` before any read: see [`pdpa-consent-gate.ts:75`](packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts#L75), [`consent-enforcement-gate.ts:67`](packages/core/src/channel-gateway/consent-enforcement-gate.ts#L67), and [`calendar-book-consent.ts:99`](packages/core/src/skill-runtime/tools/calendar-book-consent.ts#L99). `buildObserveGovernanceConfig` ([`governance-config.ts:238`](packages/schemas/src/governance-config.ts#L238)) is the canonical "all gates observe" posture that seeds and parity tests share so they cannot drift.

**How it's used at runtime.** An org flips `consentState.mode` from `off` to `observe`; gates begin reading consent and persisting verdicts but never block. After the observe bake looks clean, ops flips to `enforce` and the _same_ code path now suppresses sends/bookings. No code change ships the activation.

**Gotchas.** Note the asymmetry in corrupt-config handling: consent fails _open_ to `off` (a missed block is recoverable), but `resolveRecoveryConfig` for Robin's mass-outbound cron fails _closed_ to `off` (an erroneous mass send is not). "Fail open vs fail closed" is a per-capability judgment, not a global rule.

### Derived consent status and the operational/proactive matrix

**Concept.** Rather than store a status enum that can drift from the timestamps, derive it. And gate different _classes_ of message differently: a transactional message (booking confirmation) tolerates a looser bar than an unsolicited marketing message.

**In Switchboard.** `deriveConsentStatus` ([`packages/schemas/src/pdpa-consent.ts:57`](packages/schemas/src/pdpa-consent.ts#L57)) computes `not_applicable | pending | granted | revoked` from three fields, with revocation taking precedence over grant by construction:

```ts
if (!c.pdpaJurisdiction) return "not_applicable";
if (c.consentRevokedAt) return "revoked";
if (c.consentGrantedAt) return "granted";
return "pending";
```

`evaluateConsentGate` ([`pdpa-consent.ts:86`](packages/schemas/src/pdpa-consent.ts#L86)) applies the policy matrix: `operational` allows `not_applicable/pending/granted` and blocks only `revoked`; `proactive` additionally blocks `pending`. A contact with no jurisdiction (`not_applicable`) is never an obstacle, which is why `evaluateExceptions` ([`packages/core/src/receipts/evaluate-exceptions.ts:38`](packages/core/src/receipts/evaluate-exceptions.ts#L38)) only raises `missing_consent` when `pdpaJurisdiction` is set and consent is absent/revoked.

**How it's used at runtime.** The skill-runtime hook always evaluates with `messageClass: "operational"` (an inbound reply is transactional). The booking precondition reuses `proactive` because a booking is an outbound commitment. The receipts/completeness report uses the same derivation to flag non-bookable opportunities for operator follow-up.

**Gotchas.** The matrix lives in one pure function imported by every call site, so SG-vs-MY substantive difference is expressed by _when grant is requested_, not by branching the gate. Study how `messageClass` is the only knob that changes strictness, and how `not_applicable` deliberately means "outside PDPA scope", not "unknown".

### Inbound revocation: language-specific keyword scanning + acknowledgment

**Concept.** Customers revoke in their own words, not always with a literal `STOP`. You need locale-aware detection that is _conservative_ (a false revoke silently kills a real lead) and contextual (avoid matching benign phrases).

**In Switchboard.** Keyword tables are per-jurisdiction. SG ([`revocation-keywords/sg.ts`](packages/core/src/consent/revocation-keywords/sg.ts)) includes colloquial Malay like `jangan hubungi` ("don't contact"). MY ([`revocation-keywords/my.ts`](packages/core/src/consent/revocation-keywords/my.ts)) deliberately contextualizes stop-verbs with messaging nouns to dodge medical false positives:

```ts
// Excludes 'berhenti makan ubat' (stop taking medicine)
patterns: [/\bberhenti\b.*\b(hantar|pesanan|mesej|whatsapp|sms|hubung)/i, /\bberhenti hantar\b/i],
```

`scanForRevocationKeywords` ([`scanner/revocation-keyword-scanner.ts:17`](packages/core/src/consent/scanner/revocation-keyword-scanner.ts#L17)) is a pure function returning all matches. The `runConsentRevocationGate` ([`channel-gateway/consent-revocation-gate.ts:23`](packages/core/src/channel-gateway/consent-revocation-gate.ts#L23)) runs **pre-input, before the escalation gate**: in `enforce` mode it calls `recordRevocation(source: "inbound_keyword_revocation", ...)`, sends a deterministic locale-specific ack from `REVOCATION_ACK` ([`revocation-ack.ts`](packages/core/src/consent/revocation-ack.ts)), and returns `"revoked"` so the caller skips submission entirely.

**How it's used at runtime.** Inbound message arrives at the channel gateway, revocation gate scans it, a match in enforce mode writes `consentRevokedAt`, flips the conversation to `human_override`, builds a handoff package, sends "Got it, we won't message you further", and stops. In `observe` mode it only persists a `warning` verdict and proceeds.

**Gotchas.** The MY comment captures real wisdom: "false-positive revoke is worse than missed revoke" because the escalation gate catches nuanced complaints as a fallback. Also note the ack text is hardcoded, not model-generated, so a compliance team can review the exact words and gateway internals never leak.

### Send-time enforcement gate (the egress backstop)

**Concept.** Even after you set `consentRevokedAt`, a message generated _before_ that write committed may still be in flight. You need a final gate at the egress boundary to catch the race.

**In Switchboard.** `runConsentEnforcementGate` ([`consent-enforcement-gate.ts:33`](packages/core/src/channel-gateway/consent-enforcement-gate.ts#L33)) runs immediately before `replySink.send(...)`. It reads `consentRevokedAt`; under `enforce` with a revocation present it returns `"blocked"` (caller suppresses both `send` and `addMessage`) and emits a `critical` verdict. Under `observe` it emits a `warning` and returns `"allowed"`. Resolver errors with a cached enforce posture **fail open with audit** (`reasonCode: "governance_unavailable"`, still `"allowed"`).

**How it's used at runtime.** This is the primary enforcement for operational responses; the `afterSkill` hook is backup defense for scheduled messages. Together they form defense-in-depth against the revocation-race.

**Gotchas.** Notice the deliberate fail-open on resolver error here, paired with a critical audit row, so a config-fetch outage never blocks all replies but is never invisible either. Contrast this with the booking precondition below, which fails _closed_.

### Flag-gated booking precondition (fail-closed, inside the tool)

**Concept.** Some actions are irreversible commitments and must be validated _before_ persistence, fail-closed. Putting this check inside the tool (not as a governance constraint) matters because constraints never reach the executor.

**In Switchboard.** `enforceConsentPrecondition` ([`calendar-book-consent.ts:93`](packages/core/src/skill-runtime/tools/calendar-book-consent.ts#L93)) is injected into the booking tool. `off` returns `null` without reading; `observe` reads but never blocks; `enforce` evaluates with `messageClass: "proactive"` (allowing only `granted`/`not_applicable`) and returns a non-retryable `CONSENT_REQUIRED` `ToolResult` before any write. A read error under enforce blocks:

```ts
if (mode === "enforce") {
  console.error("[calendar-book] consent read failed under enforce; blocking booking", err);
  return consentRequiredFailure(ids.orgId, "read_error");
}
```

**Gotchas.** This reuses the `proactive` matrix rather than inventing a fourth message class. The fail-closed direction is the opposite of the egress gate, because a wrongly-created booking is a real-world commitment, while a wrongly-suppressed reply is recoverable.

### Versioned AI disclosure + observe-only detection

**Concept.** Transparency obligations change over time; you need to know _which version_ of the disclosure each contact saw, for change-management audits.

**In Switchboard.** `DISCLOSURE_COPY` ([`consent/disclosure-copy.ts:18`](packages/core/src/consent/disclosure-copy.ts#L18)) holds version-stamped text per jurisdiction (`sg-disclosure@1.0.0`, `my-disclosure@1.0.0`); MY's copy includes an explicit consent prompt because MY PDPA requires consent before processing. The `afterSkill` hook ([`pdpa-consent-gate.ts:180`](packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts#L180)) does a **deterministic substring match** of the expected text against `result.response`. First-time detection or a version mismatch calls `recordDisclosureShown` (stamping `aiDisclosureVersionShown`); a miss emits an observe-level `disclosure_not_shown` or `disclosure_version_outdated` warning _without blocking_.

**Gotchas.** The substring match is intentionally fragile: the code comments admit "punctuation, whitespace, and markdown drift will break detection", deferred until copy stabilizes. Versioning is a regulatory artifact changed via PR review, not per-tenant config.

### Tenant isolation, the read seam, and verdict persistence

**Concept.** Consent data is PHI-adjacent, so cross-tenant reads/writes must be impossible by construction, governance logic must stay Prisma-free for testability, and every mutation must leave an audit trail without letting audit failures abort the mutation.

**In Switchboard.** Every `ConsentStateStore` mutation requires `organizationId` and scopes its WHERE by it ([`consent-store.ts:16`](packages/core/src/consent/consent-store.ts#L16)); a cross-tenant target matches zero rows and `assertScoped(count, contactId)` raises `ContactNotFound` ([`prisma-consent-store.ts:32`](packages/db/src/prisma-consent-store.ts#L32)). Reads go through the `ContactConsentReader` interface ([`contact-consent-reader.ts:8`](packages/core/src/consent/contact-consent-reader.ts#L8)) so core never imports Prisma (the Layer-3 rule). Every consent mutation calls `persistVerdict` ([`consent-service.ts:126`](packages/core/src/consent/consent-service.ts#L126)), and persistence failures are logged but never abort the mutation:

```ts
} catch (err) {
  // Emission integrity > persistence completeness, mirror 1b-1/1b-2.
  console.error("[consent-service] verdict persistence failure", err);
}
```

**Gotchas.** `readOrNull` takes `organizationId` _optionally_: the service always passes it; only single-deployment infra paths (the egress gate) may omit it. Verdict audit levels are graded (`info` for grant, `critical` for revoke), which is how a PDPA auditor reconstructs a contact's lifecycle by reason code.

### WhatsApp 24-hour window + opt-in (orthogonal to PDPA)

**Concept.** Platform policy and data-protection law are _different_ gates. Meta's Business Messaging Policy lets you message freely within 24h of a customer's inbound but requires an approved template plus opt-in outside it. This is independent of PDPA consent.

**In Switchboard.** The window gate ([`whatsapp-window-gate.ts:150`](packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts#L150)) checks freshness first; inside the window it allows without opt-in. Outside, it requires `messagingOptIn`, then an `approved` template, and gates marketing-template substitution behind `allowMarketingTemplateSubstitution` (default false). The fields are distinct from PDPA on `Contact` ([`schema.prisma:1803`](packages/db/prisma/schema.prisma#L1803)): `messagingOptIn`, `messagingOptInSource` (`"ctwa" | "organic_inbound" | "web_form" | "manual"`).

**Gotchas.** Keep the two straight: PDPA consent blocks _all_ outbound (operational and marketing); the WhatsApp window gate only governs _template substitution_ outside the 24h window. A contact can be PDPA-granted yet still blocked by a missing approved template, and vice versa.

---

# Pillar 2: Human-in-the-loop governance for AI actions

This pillar covers the enforcement seam every mutating action passes through, the durable approval lifecycle that handles human sign-off, and the citation-grounding pipeline that keeps regulated claims substantiated.

---

## Default-deny enforcement & the cross-cutting governance seam

This section teaches the governance "seam": the single point in Switchboard where every mutating action is judged before it can run. The unifying idea is **fail-closed enforcement**: when the system is uncertain, it denies or parks rather than executes. For an AI platform that can spend real ad budgets and message real customers, this is the difference between "an agent did something unexpected" and "an agent spent $20,000 unsupervised." We walk the pipeline in roughly the order an action flows through it: ingress, the auto-approve short-circuit and its financial guards, the policy engine and its floors, risk and approval routing, and the final decision that ingress consumes.

The whole evaluation lives behind one method, `GovernanceGate.evaluate()` in [`packages/core/src/platform/governance/governance-gate.ts:143`](../../../../packages/core/src/platform/governance/governance-gate.ts#L143), called from `PlatformIngress.submit()` at [`packages/core/src/platform/platform-ingress.ts:259`](../../../../packages/core/src/platform/platform-ingress.ts#L259). Everything below is wiring inside or around that call.

### GovernanceGate evaluation pipeline

**Concept.** A _policy enforcement point_ (PEP) is a single chokepoint that every request must pass through so authorization logic is not scattered across call sites. Centralizing it makes the system auditable and prevents "I forgot to check permissions on this new route" bugs.

**In Switchboard.** `GovernanceGate.evaluate(workUnit, registration)` is the PEP. It (1) resolves execution constraints from any deployment `trustLevelOverride`, (2) builds an `ActionProposal` once via `toActionProposal` so the financial guard and the policy engine share one instance, (3) checks the auto-approve short-circuit, then (4) loads identity, policies, cartridge, and governance profile _in parallel_ and calls the pure policy engine:

```ts
const [identityResult, policies, cartridge, govProfile] = await Promise.all([
  this.deps.loadIdentitySpec(workUnit.actor.id),
  this.deps.loadPolicies(workUnit.organizationId),
  cartridgeId ? this.deps.loadCartridge(cartridgeId) : Promise.resolve(null),
  this.deps.getGovernanceProfile(workUnit.organizationId),
]);
```

The gate is a thin orchestrator; the real ordered checks live in `evaluate()` in [`policy-engine.ts:468`](../../../../packages/core/src/engine/policy-engine.ts#L468). The gate is **stateless per request** and the engine is deterministic given inputs, same inputs, same decision, which is what makes the `WorkTrace` audit meaningful.

**Runtime path.** Inbound message or cron -> `PlatformIngress.submit()` normalizes a `WorkUnit` and looks up the `IntentRegistration` -> `governanceGate.evaluate()` -> `GovernanceDecision` -> ingress denies, parks, or dispatches execution.

**Gotchas.** The gate catches any thrown error and converts it to a hard `deny` with `reasonCode: "GOVERNANCE_ERROR"` ([`platform-ingress.ts:260-266`](../../../../packages/core/src/platform/platform-ingress.ts#L260)). That is fail-closed: an exception during evaluation never falls through to execute. Study next: how `toActionProposal` / `toEvaluationContext` project a `WorkUnit` into the engine's vocabulary, the engine never sees a `WorkUnit`.

### Default-deny policy baseline

**Concept.** _Default-deny_ (whitelisting) means the absence of an explicit permission is itself a denial. The opposite, default-allow, is how most accidental-exposure incidents happen.

**In Switchboard.** Inside the engine, `evaluatePolicyRules()` starts `policyDecision` as `null` and only an explicitly matched `allow`/`require_approval` policy sets it. In Step 10 the null is coalesced to deny:

```ts
// Step 10: Final decision, default deny if no policy matched
builder.finalDecision = policyResult.policyDecision ?? "deny";
```

[`policy-engine.ts:588-589`](../../../../packages/core/src/engine/policy-engine.ts#L588). So an action that matches no seeded policy and is not a trusted behavior is denied regardless of the actor's trust level. The _producer_ of that null-or-allow value is `evaluatePolicyRules()` ([`policy-engine.ts:264`](../../../../packages/core/src/engine/policy-engine.ts#L264)); the _enforcer_ is line 589; the _consumer_ is `toGovernanceDecision()`.

**Gotchas.** The default-deny only bites when control actually reaches Step 10. A _trusted behavior_ (next concept) returns `allow` before Step 10 ([`policy-engine.ts:582`](../../../../packages/core/src/engine/policy-engine.ts#L582)), and the `system_auto_approved` short-circuit returns `execute` before the engine runs at all. Default-deny is the floor for the policy path, not a universal backstop, that is why the short-circuit needs its own guards.

### Forbidden & trust behaviors

**Concept.** Coarse allow/deny lists that sit _above_ fine-grained policy rules. A categorical "never do X" (deny floor) and a "always-safe X" (fast allow) are cheaper and harder to misconfigure than a policy.

**In Switchboard.** `checkForbiddenBehavior()` ([`policy-engine.ts:66`](../../../../packages/core/src/engine/policy-engine.ts#L66)) checks `resolvedIdentity.effectiveForbiddenBehaviors`; a match sets `finalDecision = "deny"` and returns `true` to short-circuit the whole engine. `checkTrustBehavior()` ([`policy-engine.ts:98`](../../../../packages/core/src/engine/policy-engine.ts#L98)) records whether the action is trusted; if so, after approval is computed, the engine forces `allow` with `approvalRequired = "none"` ([`policy-engine.ts:582`](../../../../packages/core/src/engine/policy-engine.ts#L582)). These lists are _resolved_ values, merged from the base `IdentitySpec` plus active role overlays in `resolveIdentity()`.

**Gotchas.** Forbidden runs at Step 1, trust is honored at Step 9.5, so forbidden wins over trust. Note ordering: forbidden returns immediately, but trust does not bypass the spend-limit floor (Step 6 runs before the trust allow is applied), so a "trusted" action still cannot exceed a spend limit.

### Role overlays

**Concept.** _Contextual policy composition_: instead of cloning a whole identity per situation, you layer conditional adjustments (this cartridge, this risk category, this time window) onto a base.

**In Switchboard.** `resolveIdentity()` ([`identity/spec.ts:22`](../../../../packages/core/src/identity/spec.ts#L22)) filters overlays by `active` and `matchesOverlayConditions`, sorts by `priority`, and applies each in `restrict` or `extend` mode:

```ts
if (overlay.mode === "restrict") {
  effectiveSpendLimits = mergeSpendLimitsRestrictive(
    effectiveSpendLimits,
    overlay.overrides.spendLimits,
  );
} else {
  effectiveSpendLimits = mergeSpendLimitsPermissive(
    effectiveSpendLimits,
    overlay.overrides.spendLimits,
  );
}
```

Overlays can only _add_ forbidden behaviors and _remove_ trust behaviors ([`identity/spec.ts:91-103`](../../../../packages/core/src/identity/spec.ts#L91)), the asymmetry is deliberately tilted toward tightening.

**Gotchas.** The merge direction matters: `restrict` takes the _more restrictive_ of the two values, `extend` the more permissive. A misconfigured `extend` overlay is how you would accidentally widen autonomy, so overlays are the first place to look when an actor seems "too capable."

### Hard spend-limit floor

**Concept.** A _non-overridable ceiling_. Even an explicit allow must not be able to authorize spend above a hard cap; the cap is a platform invariant, not a policy outcome.

**In Switchboard.** `checkSpendLimits()` ([`engine/spend-limits.ts:37`](../../../../packages/core/src/engine/spend-limits.ts#L37)) reads the amount via `extractSpendAmount` and compares `Math.abs(spendAmount)` against `effectiveSpendLimits` per-action plus rolling daily/weekly/monthly totals. Any breach sets `finalDecision = "deny"` and returns `true`. It runs at **Step 6, before policy rules** ([`policy-engine.ts:511-515`](../../../../packages/core/src/engine/policy-engine.ts#L511)), so no allow policy can rescue an over-limit action.

**Gotchas.** Cumulative windows only fire when `engineContext.spendLookup` is populated (the orchestrator must supply executed-spend totals); absent that, only the per-action cap applies. The `Math.abs` means a negative budget delta is still measured by magnitude.

### Extract spend amount

**Concept.** A _single source of truth_ for "the dollar amount of this action," so independent gates can never disagree about it.

**In Switchboard.** `extractSpendAmount(proposal, keys = SPEND_KEYS)` ([`engine/spend-limits.ts:26`](../../../../packages/core/src/engine/spend-limits.ts#L26)) returns the first finite number under `["spendAmount", "amount", "budgetChange", "newBudget"]`:

```ts
for (const key of keys) {
  const value = proposal.parameters[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
}
return null;
```

The same extractor feeds the spend-limit floor, the spend-approval threshold (`extractSpendAmount(proposal)` at [`governance-gate.ts:267`](../../../../packages/core/src/platform/governance/governance-gate.ts#L267)), and the financial-intent guard (with a _subset_ of keys).

**Gotchas.** The `Number.isFinite` guard is load-bearing: a `NaN` must never read as an amount, because comparison gates like `amount > limit` are all-`false` on `NaN` and would silently pass (see the codebase's recurring NaN-blind-comparison lesson). The `keys` parameter is what lets the financial guard exclude the generic `"amount"` key.

### Spend-bearing intent registration property

**Concept.** A _static capability declaration_. Rather than inferring danger from runtime data, the intent author explicitly tags an intent as committing outbound money.

**In Switchboard.** `IntentRegistration.spendBearing?: boolean` ([`intent-registration.ts:66`](../../../../packages/core/src/platform/intent-registration.ts#L66)) defaults to false. Its doc comment draws three careful lines: outbound spend (spend-bearing) is _not_ the same as expensive compute (`budgetClass: "expensive"`), nor inbound revenue recording (carries an `amount` but is _not_ spend-bearing). It is checked at registration and again at the gate.

**Gotchas.** Because it is a static flag, `operator.record_revenue` legitimately carries `parameters.amount` yet stays auto-approved, the platform refuses to _infer_ outbound spend from a bare amount.

### F4 spend-bearing auto-approve guard

**Concept.** _Defense in depth_ for a configuration invariant: enforce the same rule at registration time (fail at startup) and at evaluation time (fail at runtime).

**In Switchboard.** `assertNotSpendBearingAutoApprove()` ([`intent-registration.ts:106`](../../../../packages/core/src/platform/intent-registration.ts#L106)) throws `SpendBearingAutoApproveError` if `spendBearing === true && approvalMode === "system_auto_approved"`. It is called by `IntentRegistry.register()` ([`intent-registry.ts:14`](../../../../packages/core/src/platform/intent-registry.ts#L14)) and again inside the gate immediately before the short-circuit ([`governance-gate.ts:171`](../../../../packages/core/src/platform/governance/governance-gate.ts#L171)).

**Gotchas.** This is a _programming_ invariant, so it throws loudly rather than silently downgrading to `require_approval`. The error message itself explains _why_ (auto-approve returns execute before the spend gate). The second call exists for a registration that somehow bypassed the registry.

### System auto-approved short-circuit

**Concept.** A _fast path_ for actions that genuinely need no governance, but a fast path is also a bypass, so it must be tightly fenced.

**In Switchboard.** When `registration.approvalMode === "system_auto_approved"`, the gate returns `execute` before running the engine:

```ts
if (registration.approvalMode === "system_auto_approved") {
  assertNotSpendBearingAutoApprove(registration); // F4
  if (!isFinancialIntent(registration, proposal)) {
    // D9-2
    return {
      outcome: "execute",
      riskScore: 0,
      budgetProfile: "cheap",
      constraints,
      matchedPolicies: [],
    };
  }
  // financial: fall through to full policy path
}
```

[`governance-gate.ts:165-193`](../../../../packages/core/src/platform/governance/governance-gate.ts#L165). Crucially, the short-circuit skips _only the policy lookup_, auth, idempotency, `WorkTrace` persistence, audit, and dispatch all still run downstream.

**Gotchas.** This mode is reserved for operator-direct ingress (e.g. an operator moving an opportunity stage). The two guards (F4 static, D9-2 runtime) are what keep it from becoming a money-moving bypass.

### D9-2 runtime financial-intent guard & the financial denylist

**Concept.** A _runtime backstop_ for the case where the static flag is wrong or missing: detect financial behavior from the actual parameters and refuse the fast path.

**In Switchboard.** `isFinancialIntent()` ([`governance-gate.ts:128`](../../../../packages/core/src/platform/governance/governance-gate.ts#L128)) returns true if the intent prefix is on `FINANCIAL_AUTO_APPROVE_DENYLIST` (`adoptimizer.campaign.reallocate`, `.scale`, `.shift_budget_to_source` at [`governance-gate.ts:103`](../../../../packages/core/src/platform/governance/governance-gate.ts#L103)) or, for non-read intents, `carriesOutboundSpend()` finds a finite non-zero amount under `OUTBOUND_SPEND_KEYS`. That key set is _derived_, not hand-copied:

```ts
const OUTBOUND_SPEND_KEYS = SPEND_KEYS.filter((key) => key !== "amount");
```

When `isFinancialIntent` is true, the gate does _not_ return; it falls through to the full policy path, where default-deny applies unless a seeded `require_approval` policy parks it.

**Gotchas.** The exclusion of `"amount"` is the whole subtlety: it keeps inbound money-recording auto-approved while forcing outbound deltas through policy. The denylist is the backstop for dollars hidden in fields the extractor cannot see, and the comment says keep it tiny and add new outbound intents explicitly.

### Policy rule evaluation & precedence

**Concept.** _Deny-wins composition._ When multiple rules match, a single deny should beat any number of allows, a fail-safe ordering property.

**In Switchboard.** `evaluatePolicyRules()` sorts active policies by `priority`, then iterates. A matched `deny` sets `policyDecision = "deny"` and `break`s; an `allow` sets allow but does _not_ break, so a later deny can still flip it:

```ts
if (policy.effect === "deny") {
  policyDecision = "deny";
  break;
}
if (policy.effect === "allow") {
  policyDecision = "allow";
}
```

[`policy-engine.ts:310-320`](../../../../packages/core/src/engine/policy-engine.ts#L310). Net invariant: among matched policies, deny wins regardless of order or priority.

**Gotchas.** `modify` effect is logged but _not implemented_, it allows the action without modifying parameters and emits a `console.warn`. Treat `modify` as "allow with a TODO," not as a transform.

### Require-approval policy effect

**Concept.** A third outcome between allow and deny: _allow, but with a human in the loop._

**In Switchboard.** A matched `require_approval` policy sets `policyApprovalOverride` and ensures `policyDecision` is at least `allow` ([`policy-engine.ts:327`](../../../../packages/core/src/engine/policy-engine.ts#L327)). That override flows into `determineApprovalRequirement()`. This is the structural mechanism behind "financial intents are require_approval, never system_auto_approved", the D9-2 fall-through lands here.

### Risk scoring & risk categories

**Concept.** _Adaptive authorization_: instead of a fixed allow/deny, compute a numeric risk and route higher risk to stricter handling.

**In Switchboard.** `computeRiskScore()` ([`engine/risk-scorer.ts:63`](../../../../packages/core/src/engine/risk-scorer.ts#L63)) sums weighted factors, base risk (0-80), dollars-at-risk (capped at 20), log2 blast radius, irreversibility/volatility/learning penalties, then `scoreToCategory()` maps the raw score to `none|low|medium|high|critical` ([`risk-scorer.ts:55`](../../../../packages/core/src/engine/risk-scorer.ts#L55)). `determineApprovalRequirement()` then maps category to an approval level via `effectiveRiskTolerance`, and a matched policy's `riskCategoryOverride` can bump it.

**Gotchas.** Risk input comes from the cartridge (`getRiskInput`); if the cartridge throws or is absent, the gate falls back to `DEFAULT_RISK_INPUT` (`baseRisk: "low"`, `reversibility: "full"`). So most actions score low _unless a cartridge enriches them_, risk scoring is only as good as cartridge population.

### Governance profile & system risk posture

**Concept.** An _org-wide policy dial_ that tightens approvals globally without seeding per-action policies.

**In Switchboard.** `getGovernanceProfile()` yields `observe|guarded|strict|locked`; `profileToPosture()` ([`governance/profile.ts:11`](../../../../packages/core/src/governance/profile.ts#L11)) maps these to `normal|elevated|critical`. In `determineApprovalRequirement()`, `critical` forces `mandatory` and `elevated` bumps `none|standard` up to `elevated` ([`policy-engine.ts:424-451`](../../../../packages/core/src/engine/policy-engine.ts#L424)). Absent config defaults to `guarded` -> `normal` (no escalation).

**Gotchas.** This only _tightens_ approval, never loosens it, and it cannot rescue a deny. A `locked` org turns every routine action into a mandatory-approval action.

### Spend-approval threshold (autonomy lever)

**Concept.** A bounded, opt-in _relaxation_ of human-in-the-loop: small reversible spends auto-execute, larger ones still ask.

**In Switchboard.** `applySpendApprovalThreshold()` ([`spend-approval-threshold.ts:42`](../../../../packages/core/src/platform/governance/spend-approval-threshold.ts#L42)) post-processes the decision. It is dormant unless `trustLevelOverride === "autonomous"` _and_ `spendAutonomyEnabled === true` _and_ a finite threshold exists. It never touches a `deny`. At/under threshold it flips a _reversible, standard_ `require_approval` to `execute`; over threshold it escalates an `execute` to `require_approval`.

**Gotchas.** Only `standard` approvals relax, `elevated`/`mandatory` stay parked. The reversibility brake reduces in production to `mutationClass !== "destructive"` because no cartridge populates `reversibility` (it defaults to `"full"`); the code comment warns that any future irreversible financial executor _must_ register as `destructive`. With no config seeded, behavior is byte-identical to baseline.

### Governance decision outcomes, approval routing, and the WorkTrace record

**Concept.** The PEP must hand a _closed set of outcomes_ to the policy enforcement _dispatch_, and every decision must be auditable.

**In Switchboard.** `toGovernanceDecision()` ([`decision-adapter.ts:4`](../../../../packages/core/src/platform/governance/decision-adapter.ts#L4)) turns the `DecisionTrace` into the discriminated `GovernanceDecision` union (`execute | require_approval | deny`, [`governance-types.ts:19`](../../../../packages/core/src/platform/governance-types.ts#L19)). `PlatformIngress.submit()` consumes it: deny -> failed `ExecutionResult` ([`platform-ingress.ts:291`](../../../../packages/core/src/platform/platform-ingress.ts#L291)); require_approval -> a `pending_approval` result plus `createGatedLifecycle()` and an approval notification ([`platform-ingress.ts:304-348`](../../../../packages/core/src/platform/platform-ingress.ts#L304)); execute -> dispatch. `routeApproval()` ([`approval/router.ts:37`](../../../../packages/core/src/approval/router.ts#L37)) resolves expiry per level (mandatory/elevated/standard) and approvers (`delegatedApprovers` over config defaults), with a deny-when-no-approvers safety. Every outcome is persisted by the trace persister with `governanceOutcome`, `riskScore`, and `matchedPolicies`.

**Gotchas.** `require_approval` is _not_ final, it queues for human review and can still expire to deny. And `matchedPolicies` in the decision is built from _all matched check codes_, not just policy rules ([`decision-adapter.ts:8`](../../../../packages/core/src/platform/governance/decision-adapter.ts#L8)), so the `SPEND_APPROVAL_THRESHOLD` marker and floor checks show up there for audit. Study next: how the gated lifecycle, on approval, re-enters dispatch rather than re-running the gate.

---

## Approval gates & full approval lifecycle

When an autonomous agent can spend money, send messages to customers, or mutate external systems, you need a place where a human can say "yes, do exactly this" before it happens, and you need that yes to be auditable, tamper-proof, and recoverable when execution fails. This cluster is Switchboard's answer: a small state machine (the _approval lifecycle_) that sits between governance (the gate that decides whether human sign-off is needed) and execution (the dispatch engine that actually runs the action). The transferable idea is **human-in-the-loop as durable state, not as a UI callback**. Approval is modeled as rows in a database with versions, frozen snapshots, and explicit terminal states, so that an approval can survive a process crash, a redeploy, or a multi-day delay, and so that the thing the operator approved is provably the thing that runs.

A useful mental model before the details: an inbound action flows `ingress -> governance gate -> (execute | deny | park) `. "Park" means create an `ApprovalLifecycle` in `pending`. An operator later responds (`approve` / `patch` / `reject`). Approve _materializes_ a frozen `ExecutableWorkUnit` and then _dispatches_ it. If dispatch fails, the lifecycle becomes `recovery_required` and comes back to the operator as a retry card. Expiry sweeps abandoned pending approvals to `expired`.

### ApprovalLifecycleStatus: the state set

A lifecycle state machine needs a closed, named set of states so every consumer reasons about the same world. Vague "is it done?" booleans rot; an enum forces exhaustive handling.

**In Switchboard.** Six states are defined as a Zod enum in [packages/schemas/src/approval-lifecycle.ts:3-10](packages/schemas/src/approval-lifecycle.ts):

```ts
export const ApprovalLifecycleStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "recovery_required",
]);
```

The persisted row ([packages/schemas/src/approval-lifecycle.ts:13-25](packages/schemas/src/approval-lifecycle.ts)) carries `status`, a `version` integer (`min(1)`) used for optimistic locking, `currentRevisionId`, `currentExecutableWorkUnitId`, `expiresAt`, and a nullable `organizationId` for tenant scoping. The schema is the contract; the Prisma model in `packages/db/prisma/schema.prisma` stores it with `status String @default("pending")`.

**How it's used at runtime.** Every transition routes through `ApprovalLifecycleService.transitionStatus` / `updateLifecycleStatus`, which is version-checked and org-scoped (see store below). `pending` is the only non-terminal, operator-actionable-via-respond state; `recovery_required` is the second actionable state ([packages/core/src/approval/lifecycle-service.ts:62-68](packages/core/src/approval/lifecycle-service.ts)); `approved` is a committed-but-maybe-not-yet-run state; `rejected`/`expired` are terminal.

**Gotchas.** `superseded` is declared but **unimplemented**. No code path emits it (grep for it: only the enum and a UI design doc reference it). The system today allows multiple coexisting `pending` approvals for the same action rather than superseding older ones. Treat it as aspirational, not behavior you can rely on.

### Creating a gated lifecycle (the park)

When a gate returns "needs approval", you must atomically persist _both_ the lifecycle and an immutable first snapshot of what is being approved, or you risk an approval pointing at nothing.

**In Switchboard.** `PrismaLifecycleStore.createLifecycleWithRevision` ([packages/db/src/storage/prisma-lifecycle-store.ts:21-60](packages/db/src/storage/prisma-lifecycle-store.ts)) writes the `ApprovalLifecycle` (`status: "pending"`, `version: 1`, `currentRevisionId` pointing at the revision) and the `ApprovalRevision` (revisionNumber 1, `parametersSnapshot`, `approvalScopeSnapshot`, `bindingHash`, `createdBy`) inside one `prisma.$transaction([...])`. The service entry is `createGatedLifecycle` ([lifecycle-service.ts:70-74](packages/core/src/approval/lifecycle-service.ts)).

The producer is `PlatformIngress.submit` step 6 ([packages/core/src/platform/platform-ingress.ts:303-348](packages/core/src/platform/platform-ingress.ts)). On a `require_approval` decision it first persists the `WorkTrace` with outcome `pending_approval`, then computes a binding hash and calls `createGatedLifecycle` with `expiresAt = now + routingConfig.defaultExpiryMs`, returning `approvalRequired: true, lifecycleId, bindingHash` to the caller.

**How it's used at runtime.** An inbound chat or API action -> `submit` -> `GovernanceGate.evaluate` returns `require_approval` -> trace persisted as `pending_approval` -> lifecycle + revision row created -> `approvalNotifier.notify(...)` fired-and-forget (Slack/UI). The operator sees a card.

**Gotchas.** Notification is best-effort: a throwing notifier is caught and logged so it can never fail the park ([platform-ingress.ts:375-381](packages/core/src/platform/platform-ingress.ts)). And the lifecycle is only created _if_ `config.lifecycleService` is wired; otherwise `submit` falls back to legacy `approvalRequired: true` with no lifecycle row. Whether you are on the lifecycle path is a deployment-config fact, not a guarantee.

### Binding hash: approve-exactly-what-runs integrity

A binding hash is a content hash over everything that defines an action (envelope, params, governance decision, actor), so a later "approve" can prove the parameters haven't silently changed between display and execution. This is the structural defense against the "approve blindly" and "swap the payload after sign-off" attacks.

**In Switchboard.** `computeBindingHash` ([packages/core/src/approval/binding.ts:4-22](packages/core/src/approval/binding.ts)) canonicalizes (`canonicalizeSync`, a deterministic JSON serializer so key order can't change the hash) over `envelopeId`, `envelopeVersion`, `actionId`, `parameters`, `decisionTraceHash`, and `contextSnapshotHash`, then SHA-256s it. `validateBindingHash` compares with `timingSafeEqual` to avoid timing side channels.

```ts
const input = canonicalizeSync({
  envelopeId,
  envelopeVersion,
  actionId,
  parameters,
  decisionTraceHash,
  contextSnapshotHash,
});
return createHash("sha256").update(input).digest("hex");
```

The hash is produced at park time ([platform-ingress.ts:325-331](packages/core/src/platform/platform-ingress.ts)) and validated on approve and on patch: `approveRevision` throws `"Stale binding"` if `currentRevision.bindingHash !== clientBindingHash` ([lifecycle-service.ts:132-134](packages/core/src/approval/lifecycle-service.ts)); `createRevision` throws if `sourceBindingHash` doesn't match ([lifecycle-service.ts:95-97](packages/core/src/approval/lifecycle-service.ts)).

**Gotcha.** The operator UI must echo the hash it was shown back into the approve call. If parameters were patched, the hash changes (new revision, new hash), so an approve carrying the _old_ hash is rejected as stale, forcing the operator to re-confirm the new parameters.

### Revisions, patching, and supersession

Operators often want to nudge parameters before approving (lower a spend, fix a phone number). You model this as _append-only revisions_ rather than mutating the original, so the audit trail shows exactly what was proposed, what was changed, and by whom.

**In Switchboard.** `respondViaLifecycle` builds a patched param set (`{...trace.parameters, ...patchValue}`), computes a fresh binding hash, and calls `createRevision` with `supersedesRevisionId = currentRevision.id` ([packages/core/src/approval/respond-via-lifecycle.ts:97-122](packages/core/src/approval/respond-via-lifecycle.ts)). The store assigns `revisionNumber = max + 1` and re-points `lifecycle.currentRevisionId` via an org-scoped `updateMany`, throwing on `count === 0` (tenant mismatch) ([prisma-lifecycle-store.ts:92-129](packages/db/src/storage/prisma-lifecycle-store.ts)). `createRevision` is only legal while the lifecycle is `pending` ([lifecycle-service.ts:87-89](packages/core/src/approval/lifecycle-service.ts)).

**How it's used at runtime.** `patch` action -> create new revision (supersedes prior) -> immediately `approveLifecycle` against the _new_ revision's hash -> dispatch. Patch is a combined patch-and-approve in this path; the legacy surface contract is "patch responds AND executes".

**Gotcha.** Revisions form a `supersedesRevisionId` chain, but `currentRevisionId` is the single source of truth for "what approve commits". Don't confuse the chain (history) with the pointer (authority).

### Approve: the authority commit and materialization

Approval is the irreversible commit. The two dangerous failure modes are (a) approving but then executing different parameters, and (b) two approvals racing and double-committing. Switchboard closes both with a frozen snapshot plus optimistic locking.

**In Switchboard.** `approveRevision` validates the client hash, then `buildMaterializationInput` ([packages/core/src/approval/executable-materializer.ts:22-41](packages/core/src/approval/executable-materializer.ts)) freezes a payload: `frozenPayload` (intent, `revision.parametersSnapshot`, actor, org, mode, traceId), `frozenBinding` (deployment context), `frozenExecutionPolicy` (governance constraints), and `executableUntil = now + executableUntilMs` (default 3,600,000 ms). `approveAndMaterialize` ([prisma-lifecycle-store.ts:183-227](packages/db/src/storage/prisma-lifecycle-store.ts)) runs both writes in one transaction:

```ts
this.prisma.approvalLifecycle.updateMany({
  where: { id: lifecycleId, version: expectedVersion, organizationId },
  data: { status: "approved", version: expectedVersion + 1,
          currentExecutableWorkUnitId: workUnitId },
}),
this.prisma.executableWorkUnit.create({ data: { id: workUnitId, ... } }),
```

If the `updateMany` matched zero rows (someone else already advanced the version, or wrong org), it throws `StaleVersionError` and the whole transaction rolls back. The `version + organizationId` predicate is doing double duty: optimistic concurrency _and_ tenant isolation.

**How it's used at runtime.** Operator clicks approve -> `respondToApproval` (dispatcher) -> `respondViaLifecycle` -> `approveLifecycle` (authority commit) -> trace gets the frozen payload written -> dispatch. The `ExecutableWorkUnit` is now the immutable authority; the dispatch engine reads from it, never from live params.

**Gotcha.** `executableUntil` means an approved-but-undispatched unit can go stale. `validateDispatchAdmission` ([packages/core/src/approval/dispatch-admission.ts:46-52](packages/core/src/approval/dispatch-admission.ts)) refuses to dispatch a unit past `executableUntil` (`EXPIRED_WORK_UNIT`), so a long-delayed dispatch fails closed rather than running aged authority.

### Dispatch and the "fail toward dispatch-or-recovery" invariant

Once you've committed an approval, the action must _visibly_ either succeed or fail; it must never evaporate into a log line. Switchboard encodes this as an ordering invariant: after the authority commit, every later step fails _toward_ dispatch-or-recovery, never away from it.

**In Switchboard.** `runDispatch` ([packages/core/src/approval/lifecycle-dispatch.ts:79-121](packages/core/src/approval/lifecycle-dispatch.ts)) computes `attemptNumber = countDispatchAttempts + 1`, creates a `DispatchRecord` with deterministic idempotency key `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`, calls `platformLifecycle.executeApproved(lifecycle.actionEnvelopeId)` (which dispatches _from_ the WorkTrace that now carries the frozen payload), then `recordDispatchOutcome`. On a thrown error OR `success: false`, it calls `markRecoveryRequired`:

```ts
const fresh = await deps.lifecycleService.getLifecycleById(lifecycleId);
if (!fresh || fresh.status !== "approved") return;
await deps.lifecycleService.transitionStatus(fresh, "recovery_required");
```

Crucially, in `respondViaLifecycle` the legacy-row sync and envelope flip _after_ the authority commit are wrapped in try/catch and logged, never aborting ([respond-via-lifecycle.ts:163-195](packages/core/src/approval/respond-via-lifecycle.ts)). The comment is explicit: aborting here "would recreate the bare-approve hole".

**Gotcha.** Dispatch admission ([dispatch-admission.ts:20-53](packages/core/src/approval/dispatch-admission.ts)) checks four things in order: status is `approved`, the work unit's `lifecycleId` matches (`LINEAGE_MISMATCH`), it is the lifecycle's _current_ executable (`STALE_AUTHORITY`, catches dispatching a superseded unit), and not expired. A patched-then-re-approved lifecycle will have a new current work unit; the old one is now stale by design.

### Recovery_required and retry without re-approval

If an approved action's external call fails (network, rate limit, downstream 500), you don't want to re-run governance and re-collect a human approval. You want a retry that reuses the already-approved authority.

**In Switchboard.** `recovery_required` surfaces alongside `pending` via `listOperatorActionableLifecycles` ([lifecycle-service.ts:62-68](packages/core/src/approval/lifecycle-service.ts)). `respondToParkedLifecycle` ([packages/core/src/approval/respond-to-parked-lifecycle.ts:109-114](packages/core/src/approval/respond-to-parked-lifecycle.ts)) special-cases it:

```ts
if (lifecycle.status === "recovery_required") {
  if (params.action !== "approve") throw new ParkedLifecycleAlreadyRespondedError(...);
  return retryDispatch(deps, params, lifecycle);
}
```

`retryDispatch` reuses the existing `ExecutableWorkUnit` and bumps `attemptNumber` (the next deterministic idempotency key), so the `DispatchRecord` history accumulates `attempt-1`, `attempt-2`, ... as an audit trail. No new revision, no new governance pass.

**Gotcha.** Only `approve` is legal on a `recovery_required` lifecycle; reject/patch throw. The state is deliberately a narrow "retry or leave it" fork.

### Rejection and integrity-before-mutation

Rejecting must terminate the action _and_ keep canonical persistence (the `WorkTrace`) consistent. A subtle trap: never reject a trace whose integrity flags would let it skip governance on a later replay.

**In Switchboard.** `rejectLifecycle` ([lifecycle-service.ts:191-244](packages/core/src/approval/lifecycle-service.ts)) reads the trace and runs `assertExecutionAdmissible` _before_ any mutation; only then `rejectRevision` flips status to `rejected` (version-checked), and finally it updates the WorkTrace to `outcome: "failed", approvalOutcome: "rejected"`. If that trace update returns `!ok`, it **throws** rather than swallow the divergence:

```ts
if (!updateResult.ok)
  throw new Error(
    `WorkTrace update failed during rejectLifecycle (${lifecycleId}): ${updateResult.reason}`,
  );
```

**Gotcha.** Note the asymmetry vs approve: reject keeps a _legacy-first_ ordering ([respond-via-lifecycle.ts:242-279](packages/core/src/approval/respond-via-lifecycle.ts)) because no dispatch is at stake, so a raced reject dying on the legacy optimistic lock safely leaves the lifecycle `pending` and retryable. Approve flips that order because after the authority commit nothing may stand between it and dispatch.

### Expiry sweep

Pending approvals must not block an action forever. A background sweep transitions overdue pending lifecycles to the terminal `expired`.

**In Switchboard.** `listExpiredPendingLifecycles` queries `status: "pending", expiresAt: { lte: cutoff }` ([prisma-lifecycle-store.ts:285-294](packages/db/src/storage/prisma-lifecycle-store.ts)). `sweepExpiredLifecycles` ([packages/core/src/approval/lifecycle-expiry.ts:10-35](packages/core/src/approval/lifecycle-expiry.ts)) iterates and calls `expireLifecycle` on each, returning `{ expired, failed, errors }`. `expireLifecycle` is a no-op if the lifecycle is no longer `pending` ([lifecycle-service.ts:246-257](packages/core/src/approval/lifecycle-service.ts)), so a race with a concurrent approve is harmless. Separately, `listPendingLifecycles` in the _service_ filters out already-overdue rows in memory ([lifecycle-service.ts:259-263](packages/core/src/approval/lifecycle-service.ts)), so operators never see a card that will be swept.

**Gotcha.** Once `expired`, a lifecycle is terminal; `respondToParkedLifecycle` proactively expires-and-throws if it sees an overdue pending on approve ([respond-to-parked-lifecycle.ts:118-121](packages/core/src/approval/respond-to-parked-lifecycle.ts)), closing the window where an operator approves a just-expired card.

### Governance gate: where the require_approval decision is born

The lifecycle never decides _whether_ approval is needed; the governance gate does. Separating "should this be gated?" (policy) from "run the gate" (lifecycle) keeps each concern testable.

**In Switchboard.** `GovernanceGate.evaluate` ([packages/core/src/platform/governance/governance-gate.ts:143-272](packages/core/src/platform/governance/governance-gate.ts)) returns a `GovernanceDecision` with `outcome: "execute" | "require_approval" | "deny"`. It short-circuits to `execute` for `approvalMode === "system_auto_approved"` **but explicitly falls through to the full policy path for financial intents** so a spend-bearing action can never auto-approve ([governance-gate.ts:165-193](packages/core/src/platform/governance/governance-gate.ts)). It then loads identity/policies/cartridge/profile, runs the policy engine to a `DecisionTrace`, and finally `applySpendApprovalThreshold` can relax a reversible under-threshold financial `require_approval` to `execute`, or escalate an over-threshold execute, but never touches a `deny`.

**Gotcha.** `system_auto_approved` bypassing the human policy is a known sharp edge (see project memory `feedback_system_auto_approved_bypasses_spend_gates`). The financial-intent fall-through at lines 182-193 is the structural guard that keeps "financial intents are require_approval, never auto-approved" an invariant rather than a convention.

### Store interface, dispatcher fork, and quorum

Two remaining pieces tie it together. `ApprovalLifecycleStore` ([packages/core/src/approval/lifecycle-types.ts:54-115](packages/core/src/approval/lifecycle-types.ts)) is the persistence boundary so core depends on an interface, not Prisma; the in-memory implementation backs tests, `PrismaLifecycleStore` backs prod. Every mutating store method threads `version + organizationId` for lock-and-isolate.

`respondToApproval` ([packages/core/src/approval/respond-to-approval.ts:112-160](packages/core/src/approval/respond-to-approval.ts)) is the single response entry point. It looks up a lifecycle by envelope id; if present it runs the four-eyes self-approval guard (`assertNotSelfApproval`, default-deny, escape hatch `selfApprovalAllowed` from `ALLOW_SELF_APPROVAL`) and forks to `respondViaLifecycle`; otherwise it falls back to the legacy `platformLifecycle.respondToApproval`. Both share the `transitionApproval` state machine.

**Quorum.** `transitionApproval` ([packages/core/src/approval/state-machine.ts:56-115](packages/core/src/approval/state-machine.ts)) supports N-of-M sign-off: on `approve` with a `quorum`, it rejects duplicate approvers, appends a `QuorumEntry`, and only returns `status: "approved"` once `approvalHashes.length >= required`. In `respondViaLifecycle` a partial quorum short-circuits ([respond-via-lifecycle.ts:71-85](packages/core/src/approval/respond-via-lifecycle.ts)): it records the partial on the legacy row and leaves the lifecycle `pending` and undispatched. Only the final approver triggers materialize + dispatch.

**What to study next.** Trace one full path end to end with the file references above: `submit` (park) -> `createGatedLifecycle` -> operator -> `respondToApproval` -> `respondViaLifecycle` -> `approveLifecycle`/`approveAndMaterialize` -> `runDispatch` -> `recordDispatchOutcome` / `markRecoveryRequired`. The single most important invariant to internalize is the ordering discipline after the authority commit (`respond-via-lifecycle.ts` lines 124-217): everything after `approveLifecycle` is best-effort-toward-dispatch, so an approved action always lands in a visible terminal-or-recoverable state.

---

## Citation grounding & regulated-claim classification

This is the part of Switchboard's governance layer that stops the medspa agent (Alex) from telling a lead "this treatment guarantees visible slimming" when no approved evidence backs that claim. It is a three-layer pipeline: a deterministic banned-phrase gate (layer 1b-1, covered elsewhere), an LLM **claim-type classifier** (layer 2), and a **substantiation resolver** that grounds each flagged sentence against approved or regulatory sources (layer 3). The transferable idea is **citation grounding for generated text**: never let an LLM's free-text output assert a regulated fact unless that assertion can be traced to a pre-approved, dated source. For a revenue-actions platform operating in regulated verticals (SG/MY medical aesthetics under HSA/MOH/SMC rules), an ungrounded efficacy or safety claim is not a quality bug, it is a compliance liability. The whole subsystem lives under `packages/core/src/governance/classifier/` and is wired into the agent reply path by a single skill hook.

### Claim Type Enum (the 9 categories)

**Concept.** Before you can ground claims, you need a vocabulary of _what kinds of claims exist_. A closed enum turns an open-ended "is this risky?" question into a finite classification problem, and each category can then carry its own policy.

**In Switchboard.** The enum is a Zod schema, the single source of truth shared between the LLM tool schema and the runtime:

```ts
// packages/schemas/src/claim-classifier.ts:12
export const ClaimTypeSchema = z.enum([
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
]);
```

The same nine strings are described in plain language in the classifier system prompt (`packages/core/src/governance/classifier/prompt.ts:16-32`) and re-listed as a raw array used to compute the prompt hash. The kebab-case values (`safety-claim`, `medical-advice`) are deliberate: the comment at `claim-classifier.ts:7-11` notes these strings are _LLM-facing_, so the enum and the prompt must change in lockstep.

**Runtime path.** Each category routes differently in the hook: `efficacy`/`safety-claim`/`superiority`/`urgency` are `REWRITEABLE`, `testimonial`/`medical-advice`/`diagnosis` are `ESCALATE_ONLY`, `credentials` is checked against regulatory sources only, and `none` always passes (`packages/core/src/skill-runtime/hooks/claim-classifier.ts:55-61`).

**Gotcha.** Three artifacts encode these nine values (the Zod enum, the prompt prose, the hash array in `prompt.ts:45-55`) plus the tool's `input_schema.enum` in `anthropic-classifier.ts:42-52`. Adding a tenth claim type means editing all four and bumping `CLASSIFIER_PROMPT_VERSION`, or the eval baseline silently diverges.

### Claim Type Classification (Layer 2, Haiku 4.5)

**Concept.** Use a small, fast LLM as a _semantic classifier_ with **structured tool output** (constrained JSON) rather than free-text parsing. Tool-use with a strict schema means the model cannot return prose, only a typed object, which eliminates a whole class of parse failures.

**In Switchboard.** `createAnthropicClaimClassifier` calls `claude-haiku-4-5-20251001` (a real, current Anthropic model id), forcing the `classify_claim` tool:

```ts
// packages/core/src/governance/classifier/anthropic-classifier.ts:69-90
const response = await client.messages.create(
  {
    model,
    max_tokens: 256,
    system: [
      { type: "text", text: CLASSIFIER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [{ ...CLASSIFIER_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "classify_claim" },
    messages: [{ role: "user", content: sentence }],
  },
  { signal },
);
```

Two production details worth internalizing. First, **prompt caching**: both the system prompt and the tool definition carry `cache_control: { type: "ephemeral" }`, so Anthropic caches that prefix and only the per-sentence `messages` content is fresh input. The code reads `usage.cache_read_input_tokens` and feeds `recordLlmCacheEffectiveness` (`anthropic-classifier.ts:99-103`) so a silent cache bust (for example a prompt edit) surfaces in telemetry. Second, the tool is `strict: true` with `additionalProperties: false` and only `claimType` + `confidence` (`anthropic-classifier.ts:32-58`); note there are deliberately **no min/max** on `confidence` because strict tool schemas reject those, so the Zod parse (`ClassifierSentenceResultSchema`, with `.min(0).max(1)`) does the range check after the fact at `anthropic-classifier.ts:117`.

**Parallel dispatch under a budget.** `runClassifier` fans every sentence out concurrently under one `AbortController` and a per-turn `latencyBudgetMs` (default 800ms):

```ts
// packages/core/src/governance/classifier/run-classifier.ts:34-44
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), input.latencyBudgetMs);
const settled = await Promise.allSettled(
  input.sentences.map((s) =>
    input.classifier.classify({ sentence: s, model, signal: ctrl.signal }),
  ),
);
```

Budget exhaustion yields `{ status: "timeout" }` and an API/parse failure yields `{ status: "error" }`, _not_ a silent allow (`run-classifier.ts:51-56`). Outcome order maps 1:1 to input order, which the hook relies on.

**Gotcha.** Timeouts and errors **escalate**, they do not fail open (`claim-classifier.ts:215-242`). The classifier failing is treated as "we could not verify this claim," which is the conservative direction.

### Confidence Threshold Gating

**Concept.** A probabilistic classifier should not act on low-confidence guesses. A confidence floor converts "model thinks maybe efficacy at 0.4" into "treat as a non-claim," trading recall for precision to avoid over-flagging.

**In Switchboard.** The floor is the first gate inside `decideAction`, applied uniformly to every non-`none` type:

```ts
// packages/core/src/skill-runtime/hooks/claim-classifier.ts:255-261
if (result.claimType === "none") return { kind: "allow" };
// T1.1 confidence floor: a sub-threshold classification is not trusted to act.
if (result.confidence < confidenceThreshold) return { kind: "allow" };
```

The default is `0.7`, defined in the config schema as a _principled default, not an operator UI knob_ (`packages/schemas/src/governance-config.ts:46`). The comment there ties it directly to "the off->enforce flip; root of over-flag #673."

**Gotcha.** The floor only gates _acting on a successful classification_. Timeout/error outcomes carry no confidence and are handled _before_ this check, so they still escalate. Read `decideAction` top-to-bottom: status branches first, then `none`, then confidence, then per-type dispatch.

### Substantiation Resolver (Layer 3) and Paraphrase Matching

**Concept.** Once a sentence is classified as a regulated claim, **ground it**: search a tiered set of approved sources for evidence. The dispatch table encodes policy ("efficacy claims may only be backed by an operator-approved claim," "credentials may only be backed by a public regulatory source").

**In Switchboard.** The tier table is a static `Record<ClaimType, ...>`:

```ts
// packages/core/src/governance/classifier/substantiation-resolver.ts:16-26
efficacy: ["approved_compliance_claim"],
"safety-claim": ["approved_compliance_claim", "regulatory_public_source"],
superiority: ["approved_compliance_claim"],
credentials: ["regulatory_public_source"],
testimonial: [], "medical-advice": [], diagnosis: [], none: [],
```

`createSubstantiationResolver().resolve()` (`substantiation-resolver.ts:194-244`) walks the tiers in order: for `approved_compliance_claim` it calls `matchClaim`, for `regulatory_public_source` it calls `matchRegulatory`. An empty tier list returns `{ status: "missing" }` immediately (this is how `testimonial`/`medical-advice`/`diagnosis` become "always escalate"). A matched source returns `matched`, an approved claim past its freshness window returns `stale` (`isStale`: `validUntil < now` OR `reviewedAt` older than 180 days, `substantiation-resolver.ts:116-120`).

**Paraphrase matching** is the careful part. Exact-substring matching is too brittle for natural language, but fuzzy distance matching risks false positives, and the failure mode of a false positive here is _an unsubstantiated claim allowed through_. The solution is conservative containment:

```ts
// packages/core/src/governance/classifier/substantiation-resolver.ts:108-114
function paraphraseMatches(sentenceLower: string, claimLower: string): boolean {
  if (NEGATION_RE.test(sentenceLower)) return false;
  const claimTokens = significantTokens(claimLower);
  if (claimTokens.length < 2) return false;
  const sentenceTokens = new Set(significantTokens(sentenceLower));
  return claimTokens.every((t) => sentenceTokens.has(t)); // ALL tokens present, order-free
}
```

Every significant claim token (length >= 2, not a stopword) must be present in the sentence, order does not matter, and the sentence must not be negated. Numbers stay significant so "50%" never substantiates "80%". The known bound (documented in the long comment at `:92-107`): a 2-token claim can be satisfied by any sentence containing both words, but that is the _under-escalation_ direction and only runs against the org's own approved list after the classifier already flagged the sentence.

**Gotcha.** A thrown `approvedClaimStore.list` is caught and treated as a missing tier (`substantiation-resolver.ts:224-227`): emit-integrity beats observability, a DB hiccup must not crash the booking turn, it just means "not substantiated."

### Approved Compliance Claims Store and Regulatory Public Sources

**Concept.** Two complementary evidence stores: a **per-tenant operator-approved store** (dynamic, dated, reviewer-attributed) and a **static curated reference set** (jurisdiction-wide public facts). The first lets each clinic pre-approve its own marketing phrasings, the second encodes regulator-published facts everyone can cite.

**In Switchboard.** `ApprovedComplianceClaimRecord` carries the audit metadata that makes a claim citable: `reviewedBy`, `reviewedAt`, `validUntil`, scoped by `(deploymentId, jurisdiction, claimType)` (`packages/core/src/governance/classifier/approved-compliance-claim-store/types.ts:9-21`). The Prisma store is a narrow `list()` filtered by that triple, newest first:

```ts
// packages/db/src/prisma-approved-compliance-claim-store.ts:44-51
const rows = await prisma.approvedComplianceClaim.findMany({
  where: { deploymentId, jurisdiction, claimType },
  orderBy: [{ reviewedAt: "desc" }],
});
```

There is no authoring UI in this phase, claims arrive via seed/admin script. The **regulatory sources** are curated TS arrays with no live fetch: each `RegulatoryPublicSourceEntry` has `patterns` (strings or `RegExp`), an `authority` (HSA/MOH/SMC), and `sources` (URLs for the audit trail) (`regulatory-sources/types.ts:7-15`). For example `Thermage FLX` -> HSA device listing, `MOH-licensed` -> Healthcare Services Act (`regulatory-sources/sg.ts:7-42`). `loadRegulatoryPublicSources` normalizes regex flags, dedupes ids, freezes, and caches per jurisdiction (`regulatory-sources/loader.ts:26-35`).

**Gotcha.** The SG entries themselves carry compliance nuance in `notes`: `MOH-licensed` matches _generic_ licence language, but "this _named_ clinic is licensed" must still escalate (`sg.ts:40-42`). The pattern match grounds the generic phrasing, not the specific entity.

### Substantiation Cache (in-memory LRU)

**Concept.** A bounded LRU avoids re-running DB reads and regex sweeps for repeated sentences in chatty conversations. The subtlety is _what you are allowed to cache_: cache only positive, stable results so freshness changes do not require invalidation.

**In Switchboard.** `createInMemoryLRU` uses JS `Map` insertion order for LRU (delete+reinsert on `get` promotes to most-recently-used, evict the first key on overflow), default 5000 entries (`substantiation-cache.ts:46-72`). The key is `deploymentId|jurisdiction|claimType|sentenceHash`, so a match cached for tenant A is structurally impossible to serve to tenant B. Crucially, only `matched` resolutions are cached: in the resolver, `stale` and `missing` are returned without a `cache.set` (`substantiation-resolver.ts:230, 237`). That is why a newly-approved claim takes effect on the next lookup with no invalidation step.

**Gotcha.** `sentenceHash` is `sha256(lowercase(sentence))`, the hash of the _model output_, not of the approved `claimText` it matched (the comment at `substantiation-cache.ts:6-12` calls this out). Caching a `stale` result would be a latent bug: a claim re-approved tomorrow would still read stale from cache. The code avoids it by never caching non-matches.

### Rewrite Template Registry

**Concept.** When a claim cannot be grounded, you have two repair strategies: _rewrite_ it into compliant phrasing, or _escalate_ to a human. Deterministic templates (no second LLM call) make rewrites auditable and fast.

**In Switchboard.** `RewriteTemplateEntry` is keyed by `(jurisdiction, claimType)` over the four rewriteable types (`rewrite-templates/types.ts:3-14`). The SG efficacy template is the canonical example:

```ts
// packages/core/src/governance/classifier/rewrite-templates/sg.ts:5-11
{ id: "sg_efficacy_results_vary", jurisdiction: "SG", claimType: "efficacy",
  template: "Results vary between individuals, the doctor will go through what's realistic for you during consultation.",
  notes: "HSA / SMC aesthetic-practice guideline, avoids implied outcome guarantee." },
```

The hook looks up the template by claim type and, if found, splices it into the response (`claim-classifier.ts:300-324`). If no template exists for a `(claimType, jurisdiction)` pair, it escalates rather than silently allowing (`:304-313`).

**Gotcha.** Replacement is `response.replace(originalSentence, replacement)` (`claim-classifier.ts:462`), first-occurrence string replace. It depends on the exact sentence string the splitter produced still being present verbatim in `result.response`.

### ClaimClassifierHook, Governance Config Mode (off/observe/enforce), and the Verdict Audit Trail

**Concept.** Wire all of the above into the agent's reply path as a **post-generation governance hook** with a staged-rollout switch. `off`/`observe`/`enforce` is the standard safe-rollout ladder: ship dark, then telemetry-only, then enforcing.

**In Switchboard.** `ClaimClassifierHook.afterSkill` runs after the deterministic gate in the skill-runtime hook chain. It resolves per-deployment config, returns early on `mode === "off"`, and forks on mode:

- **observe** (`claim-classifier.ts:101-121`): runs the full pipeline _fire-and-forget on a detached shallow clone_ of the result, so the lead-visible reply pays zero added latency and a bug in the apply helpers cannot mutate the live `response` string. Verdicts are written with `action: "allow"` and `auditLevel: "warning"`.
- **enforce** (`:122-131`): awaits the pipeline, splices rewrites and replaces escalated replies with a handoff message, then sets `conversationStatus` to `human_override` (`applyEscalate`, `:419-420`).

There is also a **fail-closed** path: if the config resolver errors and the posture cache last saw `enforce`, the hook blocks the whole turn with a handoff (`failClosed`, `:336-371`).

Every decision writes a `GovernanceVerdict` (`claim-classifier.ts:390-404` for escalate, `:436-450` for rewrite). The record stamps `sourceGuard: "claim_classifier"`, `originalText`, `emittedText`, and a `details` blob carrying `promptVersion` (`claim-classifier@1.0.0`), `promptHash`, `schemaVersion`, `model`, `claimType`, `confidence`, and the matched source id/type/text. The reason codes are an enum with classifier-specific values: `unsupported_claim_rewritten`, `unsupported_claim_escalated`, `claim_substantiation_stale`, `classifier_timeout`, `classifier_error` (`packages/schemas/src/governance-verdict.ts:33-37`). This is what lets an auditor answer "why was this sentence flagged last Thursday, under which prompt version, at what confidence."

**Runtime path end-to-end.** Inbound lead message -> skill executor generates Alex's reply -> `afterSkill` hook fires -> `splitSentences(result.response)` -> `runClassifier` (parallel Haiku calls under the 800ms budget) -> per sentence `decideAction` (status branch, then `none`, then confidence floor, then per-type dispatch, then `substantiationResolver.resolve`) -> if any escalate, build handoff + flip conversation status; else if any rewrite, splice templates -> save one `GovernanceVerdict` per acted sentence.

**Gotcha / study next.** Escalate takes precedence over rewrite for the whole turn (`classifyAndApply`, `:176-201`): one escalate-worthy sentence converts the entire reply into a handoff, even if other sentences would only have been rewritten. And the offline **eval harness** (`evals/claim-classifier/run-eval.ts`) is the safety net for prompt drift: it runs fixtures through Haiku and Sonnet, scores per-type accuracy, and _gates on prompt-hash stability_ (a changed hash requires `--write-baseline`). It is a soft CI gate (warns, does not block), and it loads fixtures from `evals/claim-classifier/fixtures` rather than importing `GOLDEN_SET` directly, so keep both fixture sets in mind when editing claim semantics.

---

# Pillar 3: Agentic engineering across the stack

This pillar covers the execution engine that turns an inbound message or cron tick into a governed, audited, possibly human-approved action, and the eval and review tooling that regression-proofs the AI and architectural surfaces ordinary tests cannot reach.

---

## Agent/skill runtime, operator controls, execution APIs & persistence

This is the "engine room" of Switchboard: the layer that turns an inbound message or a cron tick into a governed, audited, possibly human-approved action. The transferable idea is that **autonomous LLM work is never trusted blindly**: every action a model proposes flows through a deterministic policy gate, gets persisted as an immutable audit row, and (for risky effects) parks for a human to approve before it touches the outside world. Below, each concept is presented as the general engineering pattern first, then the concrete Switchboard implementation, then the runtime path, then the sharp edges.

A useful mental model before diving in: there are two layers. The **platform layer** (`packages/core/src/platform/*`) decides _whether_ a unit of work runs (governance gate, approval parking, audit trace). The **skill runtime** (`packages/core/src/skill-runtime/*`) decides _how_ an LLM-driven skill executes (the tool-calling loop, per-tool governance, telemetry). The platform calls into the skill runtime via an "execution mode."

---

### Agent Manifest (SDK)

**Concept.** A _manifest_ is declarative metadata describing a plugin's identity, what it can do, and how much autonomy it starts with. Validating it with a schema (instead of trusting free-form config) means a malformed agent fails at registration, not at runtime in front of a customer.

**In Switchboard.** `AgentManifestSchema` is a Zod object at [packages/sdk/src/manifest.ts:15](packages/sdk/src/manifest.ts). It enforces a kebab-case `slug`, semver `version`, capability and connection requirements, and crucially a **starting autonomy level**:

```ts
governance: z.object({
  startingAutonomy: z.enum(["supervised", "guided", "autonomous"]).default("supervised"),
  escalateWhen: z.array(z.string()).default([]),
}).default({ startingAutonomy: "supervised", escalateWhen: [] }),
```

The three-value autonomy enum (`supervised` / `guided` / `autonomous`) is the **same vocabulary** the governance policy matrix uses downstream (see Governance Policy Matrix). That is the load-bearing detail: the manifest declares a _starting_ trust level, and that level later indexes into the policy table that decides which tool calls auto-approve versus require a human.

**How it's used at runtime.** Loaded and validated when an agent is registered; the default `supervised` means a brand-new agent's writes and external sends are blocked or queued until an operator promotes it.

**Gotchas.** Note the safe default is the _most_ restrictive level, not the least. Also, `escalateWhen` is just an array of strings here, it is a declaration, not enforcement. The actual escalation behavior lives in skill hooks, so do not assume listing a trigger in the manifest wires anything up.

---

### Agent Handler Interface & Agent Context (SDK)

**Concept.** A _handler interface_ is a contract: agent code implements lifecycle hooks (`onMessage`, `onTask`, etc.), and the runtime supplies a _context object_ full of capabilities (state, chat, LLM, files). This is dependency injection at the agent boundary, the agent never constructs its own DB client or HTTP sender, so the runtime stays in control of every side effect.

**In Switchboard.** `AgentHandler` ([packages/sdk/src/handler.ts:3](packages/sdk/src/handler.ts)) is five optional async methods, each taking an `AgentContext` and returning `Promise<void>`. `AgentContext` ([packages/sdk/src/context.ts:45](packages/sdk/src/context.ts)) bundles injected providers plus trust metadata:

```ts
export interface AgentContext {
  state: StateStore;
  chat: ChatProvider;
  files: FileProvider;
  browser: BrowserProvider;
  llm: LLMProvider;
  notify: (message: string | StructuredNotification) => Promise<void>;
  handoff: (agentSlug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;
  persona: AgentPersona;
  trust: { score: number; level: "supervised" | "guided" | "autonomous" };
}
```

`trust.level` reuses the manifest enum, closing the loop: capabilities are injected, but what they may _do_ is gated by `trust`.

**How it's used at runtime.** This is the **SDK-era** contract. In production the medspa agent "Alex" is actually a `SKILL.md` file executed by the skill runtime (below), not a hand-written `AgentHandler`. Treat the SDK interface as the conceptual surface; the skill runtime is the real engine.

**Gotchas.** Two parallel agent models coexist (`AgentHandler` vs skills). When tracing real behavior, follow the skill runtime, not `handler.ts`. The capability providers in `context.ts` are interfaces with no enforcement of their own, enforcement is the governance hook around tool calls.

---

### Action Request schema (SDK)

**Concept.** Modeling an action as a _state machine row_ (proposed -> approved -> executed/blocked) lets you persist and reason about pending side effects instead of firing them inline.

**In Switchboard.** `ActionRequestSchema` ([packages/sdk/src/action-request.ts:15](packages/sdk/src/action-request.ts)) tracks `status` through `ActionStatus = pending | approved | rejected | executed | blocked` and `type` through `ActionType = send_message | browse_url | read_file | write_file | api_call`. It carries `governanceResult`, `reviewedBy/At`, and `executedAt`.

**How it's used at runtime / Gotchas.** This is the _legacy_ action-tracking shape. The modern platform supersedes it with `WorkUnit` + `WorkTrace` + `ApprovalLifecycle`. If you see `ActionRequest`, you are looking at the older path; the canonical persisted object today is `WorkTrace`.

---

### Skill Definition & Skill Loader (Core Runtime)

**Concept.** Defining agent behavior as a **markdown file with YAML frontmatter** ("prompt-as-code") makes the prompt, its declared parameters, and its allowed tools versionable and lintable. The loader is a compiler: parse, validate, fail loudly on drift.

**In Switchboard.** `loadSkill` reads `skills/<slug>/SKILL.md`, splits frontmatter from body, and validates against `SkillFrontmatterSchema` ([packages/core/src/skill-runtime/skill-loader.ts:28](packages/core/src/skill-runtime/skill-loader.ts)). It produces a `SkillDefinition` ([packages/core/src/skill-runtime/types.ts:44](packages/core/src/skill-runtime/types.ts)) with `parameters[]`, `tools[]`, `body`, and `context[]` requirements. Two validations matter:

```ts
function validateToolReferences(body, declaredTools) {
  const toolRefPattern = /\b([a-z][\w-]*)\.\w+\.\w+/g; // e.g. crm-write.stage.update
  // ...flags tools used in the body but not declared in frontmatter
}
```

So the frontmatter `tools:` list is a declared allowlist, and the loader cross-checks it against `tool.operation.x` references in the prompt body. It also rejects duplicate parameter names and enum parameters with empty `values`.

**How it's used at runtime.** Called once at bootstrap. The resulting `SkillDefinition.body` becomes the system prompt; `tools[]` is resolved against the Tool Registry to build the LLM's tool list.

**Gotchas.** That regex `([a-z][\w-]*)\.\w+\.\w+` matters: a _dotted-triple_ in the body that is not a real tool will be treated as a tool reference and can break boot validation. The frontmatter `slug` is the runtime identity and must equal the deployment's `skillSlug`; the directory name is cosmetic.

---

### Skill Tool, Tool Registry & Tool Factories (Core Runtime)

**Concept.** A _tool_ is a typed function the LLM may call. Two safety patterns appear here: (1) each operation declares an **effect category** (read vs write vs irreversible) so a policy layer can reason about risk without understanding the operation; (2) tools are built by **factories that close over trusted identity** so the model cannot supply `orgId`/`contactId` itself (prompt-injection defense).

**In Switchboard.** `SkillTool` is `{ id, operations }` where each `SkillToolOperation` carries `effectCategory`, `inputSchema`, `idempotent`, and `execute()` ([packages/core/src/skill-runtime/types.ts:206](packages/core/src/skill-runtime/types.ts)). The `EffectCategory` set is `read | propose | simulate | write | external_send | external_mutation | irreversible`. The `ToolRegistry` ([packages/core/src/skill-runtime/tool-registry.ts:3](packages/core/src/skill-runtime/tool-registry.ts)) enforces that every operation has an `effectCategory` at registration and that every skill-declared tool is registered:

```ts
for (const id of declaredToolIds)
  if (!registeredToolIds.has(id))
    throw new Error(`Skill declares tool "${id}" but it is not registered`);
```

The injection defense is visible in `createCrmQueryToolFactory` ([packages/core/src/skill-runtime/tools/crm-query.ts:15](packages/core/src/skill-runtime/tools/crm-query.ts)). The factory takes stores, returns `(ctx: SkillRequestContext) => SkillTool`, and `contact.get` reads `ctx.contactId`: never a model-supplied argument:

```ts
execute: async (_params: unknown) => {
  if (!ctx.contactId) return fail("MISSING_CONTACT", ...);
  const contact = await contactStore.findById(ctx.orgId, ctx.contactId);
  return ok(sanitizeContactForPrompt(contact)); // PII-scrubbed before returning to LLM
}
```

`createCrmWriteToolFactory` ([packages/core/src/skill-runtime/tools/crm-write.ts:31](packages/core/src/skill-runtime/tools/crm-write.ts)) similarly closes over `ctx.orgId` and marks `stage.update` as `effectCategory: "write"` (gated) and validates the stage against an enum in `inputSchema`.

**How it's used at runtime.** Registered at bootstrap. The executor materializes a _fresh_ tool instance per request via the factory + `SkillRequestContext`, so trusted IDs are bound for that invocation only.

**Gotchas.** Reading data still scrubs PII before it reaches the model (`sanitizeContactForPrompt`, dropping free-text `description`). The trust boundary is "the LLM can choose _which operation_ and the _non-identity_ params, never the org/contact identity." Study `SkillRequestContext` ([packages/core/src/skill-runtime/types.ts:419](packages/core/src/skill-runtime/types.ts)) to see exactly which fields are server-authoritative.

---

### Governance Policy Matrix & Governance Hook (Skill Runtime)

**Concept.** Separate _what an action is_ (effect category) from _who is allowed to do it_ (trust level), and express the decision as a **lookup table**. A table is auditable, testable, and hard to bypass accidentally, far safer than scattered `if` checks.

**In Switchboard.** `GOVERNANCE_POLICY` ([packages/core/src/skill-runtime/governance.ts:19](packages/core/src/skill-runtime/governance.ts)) is `Record<EffectCategory, Record<TrustLevel, GovernanceDecision>>`:

```ts
write:             { supervised: "require-approval", guided: "auto-approve",    autonomous: "auto-approve" },
external_send:     { supervised: "require-approval", guided: "require-approval", autonomous: "auto-approve" },
irreversible:      { supervised: "deny",             guided: "require-approval", autonomous: "require-approval" },
```

`getToolGovernanceDecision(op, trustLevel)` first checks `op.governanceOverride?.[trustLevel]`, then falls back to the matrix. The `GovernanceHook` ([packages/core/src/skill-runtime/hooks/governance-hook.ts:6](packages/core/src/skill-runtime/hooks/governance-hook.ts)) fires `beforeToolCall`, computes the decision, logs it, and returns a proceed flag with a discriminated outcome:

```ts
if (decision === "deny") return { proceed: false, reason: "...", decision: "denied" };
if (decision === "require-approval")
  return { proceed: false, reason: "...", decision: "pending_approval" };
return { proceed: true };
```

**How it's used at runtime.** Registered in the executor's hook chain; runs before _every_ tool call. `proceed: false` halts that tool and surfaces `denied` or `pending_approval` back into the loop.

**Gotchas.** `irreversible` at `supervised` is a hard `deny`, not a queue, there is no "ask a human" escape for the most dangerous category at the lowest trust. Per-operation `governanceOverride` lets a tool be stricter or looser than the matrix; always check it before assuming the table is the final word.

---

### Skill Executor (Core Runtime)

**Concept.** The _agent loop_: call the LLM, parse tool-use blocks, run each tool (through governance), feed results back, repeat until done or a budget is hit. Bounding the loop (turns, tokens, wall-clock) is what separates a production agent from a runaway one.

**In Switchboard.** `SkillExecutorImpl.execute()` ([packages/core/src/skill-runtime/skill-executor.ts:1](packages/core/src/skill-runtime/skill-executor.ts)) orchestrates: resolve model profile -> compose `SkillRequestContext` -> before-LLM hooks -> LLM call with tool defs -> parse `<intent>` tags ([skill-executor.ts:82](packages/core/src/skill-runtime/skill-executor.ts)) -> before-tool hooks (governance) -> execute tool -> after-tool hooks -> accumulate cost/tokens -> repeat. The budget ceilings live in `DEFAULT_SKILL_RUNTIME_POLICY` ([packages/core/src/skill-runtime/types.ts:355](packages/core/src/skill-runtime/types.ts)): `maxToolCalls: 5`, `maxLlmTurns: 6`, `maxTotalTokens: 64_000`, plus per-call (`maxLlmCallMs`) and whole-conversation (`maxRuntimeMs`) abort deadlines.

Two subtle defenses worth seeing:

```ts
function escapeSentinel(value: string): string {
  return value.replaceAll("<|", "⟨|").replaceAll("|>", "|⟩"); // tool output can't close the prompt wrapper
}
```

and intent parsing that **strips and nulls on ambiguity** (2+ `<intent>` tags -> drop all, classify nothing) so hidden model text never leaks to the customer.

**How it's used at runtime.** Invoked by `SkillMode` for every skill-mode work unit. Its output (`response`, `toolCalls`, `tokenUsage`, `trace`) is what gets persisted.

**Gotchas.** The per-call abort plus whole-conversation budget exist to stop output-token-burn leaks; a timeout-like error is normalized to a budget error rather than leaking as a generic failure (`isTimeoutLikeError`). The file carries an `eslint-disable max-lines` legacy-debt marker, a real lesson in how much an "agent loop" accretes.

---

### Trace Persistence Hook (Skill Runtime)

**Concept.** Telemetry/audit persistence must run **outside** the policy gates it records, otherwise the gate could block its own audit trail.

**In Switchboard.** `TracePersistenceHook` ([packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts:48](packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts)) implements a _narrow_ `ExecutionTraceRecorder` interface (`afterSkill` + `onError`), deliberately **not** the full `SkillHook`, so it can never be dropped into the `hooks` array and trip governance `afterSkill` gates. It computes `costUsd` from model + token breakdown, links the business outcome (`deriveLinkedOutcome`), and creates one `SkillExecutionTrace` row. The `onError` leg accepts an optional `ExecutionTracePartial` so a turn that burned tokens before failing records its _real_ cost, not zero.

**How it's used at runtime.** The executor invokes it directly as a dedicated argument after every execution (success or error).

**Gotchas.** The "not a SkillHook" decision is intentional and security-relevant; if you ever refactor it into the hook array you reintroduce the bug it was built to avoid. Error traces still record burned tokens, do not assume a failed run is free.

---

### Parameter Builder Registry (Core Runtime)

**Concept.** Skills declare _what_ parameters they need; **builders** resolve runtime state (work unit, stores, contact) into concrete values. This keeps prompts data-source-agnostic.

**In Switchboard.** `BuilderRegistry` ([packages/core/src/skill-runtime/builder-registry.ts:45](packages/core/src/skill-runtime/builder-registry.ts)) maps `skillSlug -> RegisteredBuilder`. A builder may return bare params or a _rich_ result (`isRichBuilderResult`) carrying metadata like `injectedPatternIds` (outcome-informed context).

**How it's used at runtime.** `SkillMode` looks up the builder by `deployment.skillSlug` and calls it to populate parameters before the executor runs.

**Gotchas.** `register` throws on a duplicate slug, builders are singletons per skill. The rich-vs-bare return shape is a discriminated union; consumers must branch via `isRichBuilderResult`.

---

### Batch Skill Handler (Core Runtime)

**Concept.** Cron/bulk jobs differ from chat: there is no human in the loop _during_ execution, so the right pattern is "run once, then route each proposed write through governance, and **don't stop on the first denial**."

**In Switchboard.** `BatchSkillHandler.execute()` ([packages/core/src/skill-runtime/batch-skill-handler.ts:41](packages/core/src/skill-runtime/batch-skill-handler.ts)) runs `beforeSkill` hooks (circuit breaker / blast radius), builds params, resolves knowledge context, runs the skill, parses a structured `proposedWrites[]`, then iterates:

```ts
const decision = getToolGovernanceDecision(op, this.config.trustLevel);
if (decision === "auto-approve") {
  await op.execute(write.params);
  executedWrites++;
} else if (decision === "require-approval") {
  pendingApprovalWrites++; /* queued, continue */
} else {
  deniedWrites++;
}
```

It returns counts (`executedWrites`, `deniedWrites`, `pendingApprovalWrites`).

**How it's used at runtime / Gotchas.** Auto-approved writes execute _sequentially_ and **break on the first execution error** (to avoid compounding a broken state), but a _governance_ `require-approval` only increments a counter and continues. Distinguish "execution failed -> stop" from "needs approval -> queue and keep going." The cron actor must be a seeded `system` principal or the upstream governance gate hard-denies it silently.

---

### Skill Request Context & Governance Config Resolver (Core Runtime)

**Concept.** `SkillRequestContext` is the _trusted-identity envelope_ (`orgId`, `deploymentId`, `contactId`, `sessionId`, `delegationDepth`) threaded into tool factories, already covered as the injection defense. The **config resolver** is a tri-state load of per-deployment policy that fails _safe_.

**In Switchboard.** `createAgentDeploymentGovernanceResolver` ([packages/core/src/governance/governance-config-resolver.ts:32](packages/core/src/governance/governance-config-resolver.ts)) returns `{ status: "resolved" | "missing" | "error" }`. The contract is explicit: gates treat `missing` as "governance is off" and `error` as "apply a safe fallback." `delegationDepth` in the request context guards against infinite agent-delegates-to-agent recursion.

**Gotchas.** `missing` and `error` are _not_ the same; conflating them either over-blocks or silently disables policy. The resolver never throws, it returns `error` so the caller owns the fail-safe decision.

---

### Platform Ingress (Core Platform)

**Concept.** A **single mandatory entry point** for every mutating action. Funneling all writes through one `submit()` means idempotency, entitlement, governance, and audit are enforced in _one_ place, with no bypass paths.

**In Switchboard.** `PlatformIngress.submit()` ([packages/core/src/platform/platform-ingress.ts:93](packages/core/src/platform/platform-ingress.ts)) runs, in order: idempotency lookup -> entitlement -> resolve deployment -> `normalizeWorkUnit` -> governance gate -> branch on outcome. The branches:

```ts
if (decision.outcome === "deny")            { persistTrace(...); return { ok: true, result /* failed */ }; }
if (decision.outcome === "require_approval"){ persistTrace(...); createGatedLifecycle(...); /* park */ }
// else execute via the mode registry
```

The idempotency leg is sophisticated: a prior `running` trace (an unresolved _claim_) **fails closed** with `idempotency_in_flight` rather than risk a double-apply ([platform-ingress.ts:121](packages/core/src/platform/platform-ingress.ts)). When parking, it computes a `bindingHash` over `{parameters, decisionTraceHash, contextSnapshotHash}` and creates the lifecycle atomically ([platform-ingress.ts:325](packages/core/src/platform/platform-ingress.ts)).

**How it's used at runtime.** `POST /api/actions/propose` -> `submit()`. Inbound chat, dashboard mutations, and internal callers all converge here.

**Gotchas.** Idempotency runs _before_ entitlement deliberately: a replay of an already-authorized request returns the cached result even if the org later lost entitlement (the original mutation was already authorized). The `bindingHash` is the anti-race primitive: an operator approves a _specific revision_, and a changed payload invalidates the hash.

---

### Work Unit, Work Trace & Work Trace Store (Core Platform)

**Concept.** Separate the _request_ (`WorkUnit`: actor, intent, params, deployment, trust) from the _audit record_ (`WorkTrace`: governance outcome, approval state, execution result, tokens, cost, integrity hash). The trace is canonical persistence and lineage.

**In Switchboard.** `normalizeWorkUnit` ([packages/core/src/platform/work-unit.ts:30](packages/core/src/platform/work-unit.ts)) mints the `WorkUnit` with a cuid `id` and `traceId`. `WorkTraceStore` ([packages/core/src/platform/work-trace-recorder.ts:36](packages/core/src/platform/work-trace-recorder.ts)) is the persistence contract, and `claim()` is the concurrency lock:

```ts
// Atomically insert a `running` trace BEFORE the domain mutation. Returns
// { claimed: false } when (organizationId, idempotencyKey) already exists.
claim(trace: WorkTrace): Promise<WorkTraceClaimResult>;
```

Unlike `persist()`, `claim()` must **not** swallow the unique-violation, its return value _is_ the lock that gates the claim-first execute path.

**How it's used at runtime.** Ingress claims first (locking concurrent replays), executes, then updates the trace with the result. The approvals path later re-reads the trace via `getByWorkUnitId` to verify integrity _before_ dispatch.

**Gotchas.** `claim` vs `persist` have opposite P2002 semantics, claim surfaces it (lock), persist voids it (best-effort). `update` is version-checked and has a two-shape lock behavior elsewhere in the codebase (prod returns `{ok:false}`, non-prod throws). The `contentHash`/`traceVersion` fields make the trace tamper-evident.

---

### Approval Lifecycle Service, Respond-to-Parked-Lifecycle & Dispatch (Core Platform)

**Concept.** Human approval is modeled as **lifecycle state**, not a side effect of an HTTP route. A parked work unit has an `ApprovalLifecycle` row that transitions `pending -> approved -> executing -> completed`, or `-> rejected`, or `approved -> recovery_required` if dispatch fails. This makes approval resumable, retryable, and auditable.

**In Switchboard.** `respondToParkedLifecycle` ([packages/core/src/approval/respond-to-parked-lifecycle.ts:100](packages/core/src/approval/respond-to-parked-lifecycle.ts)) retrieves the lifecycle, rejects stale/expired/already-responded states, validates the `bindingHash`, blocks self-approval (`assertNotSelfApproval`), then on approve writes the frozen payload to the trace and calls `runDispatch`:

```ts
if (lifecycle.status === "recovery_required") return retryDispatch(...); // re-approve to retry
if (lifecycle.status !== "pending") throw new ParkedLifecycleAlreadyRespondedError(...);
if (lifecycle.expiresAt <= new Date()) { await expireLifecycle(...); throw ParkedLifecycleExpiredError; }
```

Dispatch (`lifecycle-dispatch.ts`) uses an idempotency key shaped `lifecycle-dispatch:<id>:<revision>:attempt-<n>` so each retry is traceable, and transitions to `recovery_required` on failure.

**How it's used at runtime.** Operator clicks Approve -> `POST /api/approvals/:id/respond` -> `respondToParkedLifecycle` -> approve transitions state, writes the approved payload to the WorkTrace, and **dispatches inline**. Reject is terminal. A dispatch failure parks for retry (the operator sees a Retry card).

**Gotchas.** The trace is the _payload authority_: the approved frozen parameters are written to the WorkTrace _before_ dispatch, and the dispatcher reads from the trace, not from the original request. Re-approving a `recovery_required` lifecycle is the retry mechanism, there is no separate retry endpoint.

---

### Skill Mode & Execution Service (Core Platform Execution)

**Concept.** An **execution mode** is a strategy: ingress decides _whether_ to run; the mode decides _how_. `ExecutionService` is a thin facade for "propose, then execute if no approval needed."

**In Switchboard.** `SkillMode.execute()` ([packages/core/src/platform/modes/skill-mode.ts:32](packages/core/src/platform/modes/skill-mode.ts)) resolves the slug, fetches the `SkillDefinition`, resolves parameters via the builder, merges resolved knowledge context (resolved context wins on key collision, an intentional precedence), then picks the executor:

```ts
const executor = this.config.executorBySlug?.get(slug) ?? this.config.executor;
```

That `executorBySlug` override is how "mira" runs on a **zero-hook** executor for internal compose, so Alex's conversation gates never fire on an internal brief. `ExecutionService.execute()` ([packages/core/src/execution-service.ts:15](packages/core/src/execution-service.ts)) returns `DENIED` / `PENDING_APPROVAL` / `EXECUTED` based on the orchestrator result discriminant.

**Gotchas.** `delegationDepth` is read from server-set work-unit params (`__delegationDepth`), never from LLM tool input, the `delegate` tool sets the child's depth itself. The slug lookup for the skill uses a legacy fallback while the _builder_ lookup uses `deployment.skillSlug` only; that divergence is deliberate so a legacy intent-prefix slug falls back to the default executor.

---

### Execution APIs: /api/actions, /api/approvals, and the dashboard proxies

**Concept.** Thin HTTP handlers over a rich domain core. The API does surface work (auth, org isolation, structured error mapping); all real logic lives in `packages/core`.

**In Switchboard.** `POST /api/actions/propose` ([apps/api/src/routes/actions.ts:1](apps/api/src/routes/actions.ts)) requires an `Idempotency-Key` header, enforces a per-skin tool filter, and calls `submit()`. `POST /api/approvals/:id/respond` ([apps/api/src/routes/approvals.ts:1](apps/api/src/routes/approvals.ts)) maps the lifecycle errors to precise status codes: a DB outage on lookup returns a **503 with a `code`**, never a code-less 400; missing `bindingHash` on approve is a 400; `assertOrgAccess` enforces tenancy. The dashboard never talks to Postgres for this, it proxies: `apps/dashboard/.../api/dashboard/approvals/route.ts` ([apps/dashboard/src/app/api/dashboard/approvals/route.ts:20](apps/dashboard/src/app/api/dashboard/approvals/route.ts)) extracts `approvalId` and forwards via an authenticated `SwitchboardClient`. The React hook `useWorkflowApprovalAction` ([apps/dashboard/src/hooks/use-workflow-approval-action.ts:27](apps/dashboard/src/hooks/use-workflow-approval-action.ts)) branches on structured codes:

```ts
if (body.code === "already_responded" || body.code === "expired") return { silent: true, body };
if (body.code === "stale_binding") {
  invalidate();
  return { staleBinding: true, body };
}
```

**How it's used at runtime.** Inbound message -> `/api/actions/propose` -> ingress -> gate. If parked, the dashboard Inbox lists it via `/api/dashboard/approvals` (GET), the operator approves, and the same hook POSTs back with the `bindingHash` it received, which the API hands to `respondToParkedLifecycle` for inline dispatch.

**Gotchas.** `respondedBy` is _never_ sent from the client, the API derives it from the authenticated principal (anti-spoofing). `already_responded`/`expired` are treated as **silent success** because a refetch will reconcile; only unexpected codes throw. The binding hash round-trips through the UI specifically to make approval atomic against a concurrent payload change.

---

### Persistence: Credential Encryption & stores

**Concept.** Secrets at rest must be encrypted with an authenticated cipher and a per-record salt, so a DB dump alone is useless.

**In Switchboard.** `encryptCredentials` ([packages/db/src/crypto/credentials.ts:23](packages/db/src/crypto/credentials.ts)) uses AES-256-GCM with a scrypt-derived key, random per-record salt and IV, and packs `salt(32) + iv(16) + authTag(16) + ciphertext` as base64. `decryptCredentials` reverses it; GCM's `authTag` makes tampering detectable. `isEncrypted` checks the packed-length invariant to avoid double-encrypting.

**How it's used at runtime.** The dashboard encrypts a user's API key before storing it; `getApiClient` decrypts on read to build the `SwitchboardClient`'s `Authorization` header. The `CREDENTIALS_ENCRYPTION_KEY` must be identical across api/chat/dashboard, or cross-service decryption fails.

**Gotchas.** The salt is stored _with_ the ciphertext (it must be, to re-derive the key), that is correct, not a leak; salt is not secret, the master key is. A scrypt derivation per encrypt/decrypt is intentionally slow; do not call it in a hot loop.

---

### What to study next

1. **Two enforcement regimes.** Governance is enforced in _two_ places with different shapes: the skill-runtime `GovernanceHook` (per tool call, effect-category matrix) and the platform `GovernanceGate` (per work unit, before any execution). Trace one denial through both to understand which fires when.
2. **Producer-population is the recurring trap.** Many gates are inert until a producer sets the data (trust level, approval threshold, governance config). A flag or table that is "wired" still does nothing until something populates it. When a control "should block but doesn't," suspect an unpopulated producer before suspecting the gate.

---

## Evaluation suites & automated design/route/contract review tooling

This pillar is about **regression-proofing the parts of an AI system that ordinary unit tests cannot reach**: the behavior of an LLM classifier, the policy table that governs which agent actions need human approval, the exact sequence of tool calls an agent emits, and the architectural invariants (every mutating route flows through one audited entry point, the LLM is never trusted for org scoping). For a revenue-actions platform, a silent regression here is not a cosmetic bug. It can mean a write executes without approval, an ad budget moves on a hallucinated recommendation, or one tenant's data is mutated under another tenant's prompt. The defenses below fall into two families:

1. **Eval harnesses** (`evals/`): golden-fixture suites that pin AI and policy behavior. The deterministic tier runs in CI with no API key and no database; a live tier (credit-gated) calls real models.
2. **Design/route/contract review tooling** (`.agent/tools/`, `scripts/`, contract tests): static analyzers and structural tests that catch architecture drift at PR time.

A recurring design principle ties them together, worth internalizing before the details: **the grader calls the real production code, never a re-implementation of it.** A test that re-encodes the policy it is checking can only ever confirm itself. Every harness here either imports the live function (`getToolGovernanceDecision`, `decideForCampaign`) or computes its expectation from facts the author did not get to declare.

### Vitest eval config, the one structural gate

**Conceptual primer.** When you have many eval suites, you want a single command that runs only the _deterministic_ subset (no secrets, no flakiness) so it can be a blocking CI gate, while the model-calling parts run separately.

**In Switchboard.** [`evals/vitest.config.ts:10-16`](evals/vitest.config.ts) globs exactly the `__tests__` directories of the five suites:

```ts
include: [
  "claim-classifier/__tests__/**/*.test.ts",
  "alex-conversation/__tests__/**/*.test.ts",
  "governance-decision/__tests__/**/*.test.ts",
  "riley-recommendation/__tests__/**/*.test.ts",
  "trajectory-grading/__tests__/**/*.test.ts",
],
```

CI runs `pnpm exec vitest run --config evals/vitest.config.ts`. Note what is _excluded_: the top-level `run-eval.ts` runners (which call Anthropic) are not in the glob, so the gate is key-free by construction.

### Zod schema-based fixture validation, the shared loader contract

**Conceptual primer.** Eval fixtures are data, and untrusted data fails silently (a typo'd field gets read as `undefined` and a test passes for the wrong reason). The fix is to **validate every fixture against a schema at load time and fail fast**, the same discipline you apply to production inputs.

**In Switchboard.** Every suite has a `load-fixtures.ts` following one convention. [`evals/governance-decision/load-fixtures.ts:28-36`](evals/governance-decision/load-fixtures.ts) is representative:

```ts
const parsed = GovernanceCaseSchema.safeParse(raw);
if (!parsed.success) {
  throw new Error(`${file}:${i + 1}, schema violation: ${parsed.error.message}`);
}
if (seen.has(parsed.data.id)) {
  throw new Error(`duplicate case id: ${parsed.data.id}`);
}
```

JSONL is read line by line, `#`-comment and blank lines skipped, each line `JSON.parse`d then `safeParse`d, and duplicate IDs rejected. The same `FixtureRowSchema` / `ConversationFixtureSchema` / `TrajectoryCaseSchema` / `RileyCaseSchema` pattern repeats across the suites. This mirrors production: Alex's `BusinessFactsStore` uses `BusinessFactsSchema.safeParse` to degrade on malformed config, so the eval and the app validate config the same way.

### Claim Classifier Eval Harness, cross-run regression for an LLM

**Conceptual primer.** An LLM classifier has no stable "correct answer" you can hardcode. You measure it statistically against a **golden set** (labeled examples), record a **baseline** snapshot, and fail when a later run drifts beyond a tolerance. Two extra guards matter: pin the **prompt** (a prompt edit invalidates the baseline) and run a key-free **structural** check on the fixture set itself.

**In Switchboard.** The classifier labels marketing sentences into 9 regulatory `ClaimType` values (efficacy, safety-claim, superiority, diagnosis, etc.) across SG/MY jurisdictions, the medical-advertising compliance surface. [`evals/claim-classifier/invoke-classifier.ts:23-30`](evals/claim-classifier/invoke-classifier.ts) calls the **live** production classifier (Haiku 4.5):

```ts
const classifier = createAnthropicClaimClassifier(client);
const { result, promptHash, promptVersion } = await classifier.classify({
  sentence: row.text,
  model: "claude-haiku-4-5-20251001",
  signal,
});
```

The runner ([`evals/claim-classifier/run-eval.ts`](evals/claim-classifier/run-eval.ts)) scores results, then before regression-checking it compares the **prompt hash** against `baseline.json` (lines 76-82): if the prompt changed, it hard-fails and tells you to re-lock with `--write-baseline`. Only then does it compare per-claim-type accuracy within `toleranceBps: 200` (2 percentage points). Without a key it skips on a branch but **hard-fails on a `main` push** (lines 25-28), so the gate is real where it counts.

The **structural** half is key-free. [`golden-set.ts:29`](packages/core/src/governance/classifier/eval/golden-set.ts) defines `GOLDEN_SET` (45+ labeled entries, each with an `expectedConfidenceFloor`), and [`golden-set.test.ts:5-30`](packages/core/src/governance/classifier/eval/__tests__/golden-set.test.ts) asserts coverage with no API call: ≥40 entries, all 9 claim types, both jurisdictions.

**How it's used at runtime.** Touch the classifier prompt, the `ClaimType` enum, or a model id, then run `ANTHROPIC_API_KEY=... pnpm eval:classifier`. The deterministic `golden-set.test.ts` already runs in the standard CI gate; the live accuracy run is the informational layer.

**Gotchas / what to study next.** The prompt-hash gate is the subtle part: accuracy alone would let a "harmless" prompt tweak silently shift the decision boundary. Study how `promptHash` is derived and why an unchanged accuracy number is _not_ sufficient evidence of an unchanged classifier.

### Governance Decision Eval Harness, pinning the approval matrix

**Conceptual primer.** The heart of agent governance is a small policy table: for each _kind of side effect_ and each _trust level_, do we auto-approve, require human approval, or deny? That table is the most safety-critical code in the system, and it must be regression-pinned **deterministically** (no model, no DB) so the gate is fast and never flaky.

**In Switchboard.** The live table is [`GOVERNANCE_POLICY` in governance.ts:19-35](packages/core/src/skill-runtime/governance.ts), a 7×3 grid of `EffectCategory` (read, propose, simulate, write, external_send, external_mutation, irreversible) against `TrustLevel` (supervised, guided, autonomous):

```ts
write: { supervised: "require-approval", guided: "auto-approve", autonomous: "auto-approve" },
external_send: { supervised: "require-approval", guided: "require-approval", autonomous: "auto-approve" },
irreversible: { supervised: "deny", guided: "require-approval", autonomous: "require-approval" },
```

The eval does **not** copy this grid. [`evals/governance-decision/decide.ts:42-51`](evals/governance-decision/decide.ts) builds a minimal operation and routes it through the real gate `getToolGovernanceDecision`, including its per-op `governanceOverride` resolution. The test ([`governance-decision.test.ts:17-27`](evals/governance-decision/__tests__/governance-decision.test.ts)) asserts each fixture's `expectedDecision` matches what the live gate returns.

The **drift guard** (lines 30-53) is the clever part. It does not just check decisions; it checks that the _shape_ of the policy still matches the fixtures:

```ts
const policyCategories = Object.keys(GOVERNANCE_POLICY).sort();
expect([...EffectCategoryEnum.options].sort()).toEqual(policyCategories);
// ...and the no-override grid covers every (category × trustLevel) combination
```

So if someone adds an eighth effect category to core, the eval fails until a fixture exercises it. The matrix cannot grow a blind spot.

**How it's used at runtime.** Inbound message → `PlatformIngress.submit` → skill runtime resolves an op's `effectCategory` and the deployment's `trustLevel` → `getToolGovernanceDecision` returns the decision that gates execution. The eval pins that exact function. Change `write@supervised` from `require-approval` to `auto-approve` and the suite reds immediately.

**Gotchas / what to study next.** Note `mapDecisionToOutcome` (lines 47-56) translates the three _decisions_ into _outcomes_ (`auto-approved` / `require-approval` / `denied`). The trajectory grader reuses this, so the two suites share one source of truth. Trace how a per-op `governanceOverride` can tighten (never loosen, by intent) the table value.

### Trajectory Grading Eval Harness, was the agent's tool sequence legitimate?

**Conceptual primer.** Beyond "did the agent pick the right answer" is "did it take the right _path_". **Trajectory grading** inspects the ordered list of tool calls a run emitted and checks tool correctness (right tools, right order), argument validity, and the safety-critical one: did any call **bypass an approval gate**. The trap to avoid is a _self-confirming oracle_, if the author declares both the trajectory and the expected outcome, the test proves nothing. The fix is to **compute the mandated outcome from facts the author cannot fudge**.

**In Switchboard.** [`gradeTrajectory` in grade.ts:96-206](evals/trajectory-grading/grade.ts) runs three checks. The approval-bypass check (lines 169-202) never reads an author-declared expected outcome; it recomputes the mandate from the step's `effectCategory` plus the unit's `trustLevel` through the **same live gate** the governance eval pins:

```ts
const mandate = mapDecisionToOutcome(
  getToolGovernanceDecision(makeOp(e.effectCategory, e.governanceOverride), trustLevel),
);
if (OUTCOME_RANK[recorded] < OUTCOME_RANK[mandate]) {
  violations.push({
    kind: "approval-bypassed",
    index: i,
    detail: `${e.effectCategory}@${trustLevel} mandates ${mandate} but recorded ${recorded}`,
  });
}
```

Two further subtleties to internalize. **Fail-closed:** an unrecognized `governanceDecision` becomes a `malformed-record` violation, never a silent "no bypass" (the NaN-blind / fall-through-to-pass trap, lines 176-183). And `"simulated"` is **trusted by construction** (line 175): the executor emits it only for hook-diverted substitute calls that took no real action, so it is never a bypass.

The test ([`fixtures.test.ts:33-47`](evals/trajectory-grading/__tests__/fixtures.test.ts)) is an explicit anti-self-confirm gate: a failing fixture must produce _exactly_ the violation kinds it declares, and a coverage guard asserts all four kinds (`approval-bypassed`, `argument-invalid`, `malformed-record`, `tool-sequence-mismatch`) are exercised.

**How it's used at runtime.** Real runs persist `ToolCallRecord[]`; `findByWorkUnitId` retrieves them, parsed via `RecordedCallSchema`. The grader bridges those live traces with deterministic gate validation, so a production trajectory can be replayed and audited offline.

**Gotchas / what to study next.** The argument and approval checks match recorded calls to expected steps **by identity (toolId + operation), not by position** (lines 134-144). This is deliberate: a dropped guard call shifts positions, and a positional match would mask the resulting bypass as a mere sequence error. Study why identity-matching surfaces the bypass that position-matching hides.

### Alex Conversation Eval Suite, tiered grading of an SDR agent

**Conceptual primer.** Conversation quality has both **hard constraints** (never call a tool outside your allowed set, must escalate on a red flag, must not book in a discovery-only chat) and **soft quality** (was the reply helpful and on-policy). The mature pattern is **tiers**: a deterministic tier (machine-checkable, no key, blocking) and an LLM-judge tier (semantic, credit-gated, advisory).

**In Switchboard.** Tier 1 lives in [`evals/alex-conversation/grade.ts`](evals/alex-conversation/grade.ts). The global allowlist (lines 7-14) is the hard floor: `crm-query`, `crm-write`, `calendar-book`, `escalate`, `follow-up`, `delegate`. A call outside it is the only `unexpected-tool` hard violation. Notably, the per-sentence **claim classifier is run but demoted to advisory** `claimWarnings` (lines 56-72): the marketing-copy classifier over-flags conversational SDR replies, so the LLM judge's `semanticHardRulePass` is the real claim gate. This is a sharp lesson in not letting a tool tuned for one domain hard-fail another.

Per-scenario facts the global allowlist cannot express live in the **oracle** ([`oracle.ts:25-72`](evals/alex-conversation/oracle.ts)): `expectedTools`, `forbiddenTools`, `expectsEscalation`, `expectsBooking`. The schema's `superRefine` rejects contradictory oracles at load time (e.g. `expectsEscalation: true` while `escalate` is forbidden), so a fixture cannot encode an unsatisfiable constraint. The suite assembles Alex through the production seam with a real `PrismaBusinessFactsStore` over mock Prisma, and `live-path-faithfulness.test.ts` blocks if absent BusinessFacts does not force an escalate (no fabrication).

**How it's used at runtime.** Deterministic suite + oracle structural checks run in the CI gate (coverage floors: ≥60 scenarios, ≥8 per locale, ≥6 escalation oracles, ≥10 do-not-book). `pnpm eval:alex-conversation` with a key runs Tier 2's `judgeTurn` (Sonnet).

**Gotchas / what to study next.** The advisory-vs-hard split is the takeaway: a classifier with a known false-positive profile belongs in a warning channel, not a blocking gate. Find where `semanticHardRulePass` is defined and why it is the correct claim gate for conversation.

### Riley Recommendation Eval Harness, pinning a decision pipeline

**Conceptual primer.** A rules-and-signals decision engine (here, ad-campaign recommendations) needs its outputs pinned without external dependencies. A single "primary action" label is too coarse; you want **set-membership** assertions so a silently-dropped recommendation fails the eval.

**In Switchboard.** [`decideForCase` in decide.ts:211-239](evals/riley-recommendation/decide.ts) routes each fixture through the **real** `decideForCampaign` from `@switchboard/ad-optimizer` and exposes both a reduced `primary` label and full `actions` / `watchPatterns` sets plus `confidenceByAction`. The comment captures why the sets matter: a durable-breach case must emit **both** `add_creative` and `pause`, so "a silently-dropped `pause` regression fails the eval rather than slipping past a single-label reduction." It even threads operator approval history and outcome-ledger history through the _same_ bounded confidence modifiers the live audit-runner uses, so eval and production never drift.

**How it's used at runtime.** The campaign audit-runner calls `decideForCampaign` per campaign; the eval pins that same function. A coverage drift guard ensures every `economicTier`, `learningState`, and `measurementTrusted` value, plus advisory/abstention outcomes, are exercised.

**Gotchas / what to study next.** Watch `decideRawForCase` resolve the hybrid (campaign Tier-1 vs account Tier-2) economic target through the real `resolveEconomicTargetForCampaign` (lines 139-151). The eval deliberately exercises the resolver seam, not a flattened input, because that seam is where production bugs hide.

### Contract tests, pinning invariants, not behavior

Three small tests guard architectural invariants. They are cheap and unusually high-leverage.

**Executor Trust Contract** ([`executor-trust-contract.test.ts:43-100`](packages/core/src/skill-runtime/__tests__/executor-trust-contract.test.ts)) encodes the most important multi-tenant invariant: **LLM tool args are never trusted for org scoping.** A stubbed adapter emits a tool call with a prompt-injected `orgId: "org_evil"`; the test asserts the store was called with the context-bound `org_real`:

```ts
input: { orgId: "org_evil", opportunityId: "opp_1", stage: "qualified" },
// ...
expect(opportunityStore.updateStage).toHaveBeenCalledWith("org_real", "opp_1", "qualified");
```

If anyone reverts the factory to pass through the model's `orgId`, this reds instantly. **LLM Types Contract** ([`llm-types-contract.test.ts:6-10`](packages/core/src/skill-runtime/__tests__/llm-types-contract.test.ts)) is a pure static check that the abstract adapter interface never imports `@anthropic-ai/sdk`, preserving provider independence. **Action Contract** ([`action-contract.test.ts:34-100`](packages/ad-optimizer/src/action-contract.test.ts)) pins all 14 Riley actions and, critically, asserts `isMutating()` matches the **real sink's emitted booleans** (lines 87-99), so the static contract and live elevation logic (e.g. `add_creative` is non-financial yet mutating because it resets learning) can never disagree.

**Gotcha.** These tests assert against the _real_ collaborator (the executor, the sink, the source file), not a mock of it. A contract test that mocks the thing it is supposed to pin is theater.

### Route Governance Checker, static analysis for the "one front door" rule

**Conceptual primer.** A core architectural invariant ("every mutating route flows through one audited entry point") cannot be enforced by types. You need a **static analyzer** that parses route handlers and flags any mutating handler that does not reach the front door, with an **allowlist** for sanctioned exceptions and **expiry** on temporary ones so debt cannot rot.

**In Switchboard.** [`.agent/tools/check-routes.ts`](.agent/tools/check-routes.ts) uses `ts-morph` to parse handlers. `runCheckRoutes` (lines 47-98) finds mutating handlers, checks `reachesIngress` (transitive call to `PlatformIngress.submit`), and flags violations plus direct writes to approval state:

```ts
const handlers = findMutatingRouteHandlers(sf);
if (handlers.length > 0 && !reachesIngress(sf)) {
  raw.push({
    path: repoPath,
    line: handlers[0].line,
    kind: "ingress",
    message: "mutating route handler does not reach PlatformIngress.submit",
  });
}
```

`validateTemporaryEntries` (line 50) fails the whole run if a temporary allowlist entry has expired, so suppressions are time-boxed. The companion [`route-class-validator.ts`](.agent/tools/route-class-validator.ts) reads a `// @route-class:` header (`operator-direct`, `lifecycle`, `control-plane`, `ingress-receiver`, `read-only`, `dashboard-proxy`) and applies class-specific advisories; `--mode=error` (lines 271-349) enforces that every route file carries a valid header, while the control-plane org-guard advisory is deliberately kept _out_ of the exit code (warn-only, tracked under #654) so new violations are surfaced without blocking on the un-migrated backlog.

**How it's used at runtime.** Runs as a CI lint gate. `--mode=warn-touched` advises on the PR's changed routes; `--mode=error` enforces repo-wide. A `// route-governance: operator-direct-contract-deferred #NNN` directive permits a temporary contract gap only with a GitHub issue reference attached.

**Gotchas / what to study next.** Two design choices to absorb. First, the dashboard-proxy _directory convention_ (`resolveRouteClass`, lines 93-98) blesses `api/dashboard/**` as proxies but forces outliers like `waitlist/route.ts` to carry explicit headers, because those do direct DB writes. Second, the blocking-vs-advisory split: blocking advisories feed `exitCode`, control-plane org-guard does not. Trace which list a finding lands in before assuming it gates merges.

### Audit Findings Validator, linting the audit documents themselves

**Conceptual primer.** When audits are a first-class artifact, the _documents_ need structure so findings stay traceable. A linter over the markdown enforces required fields, valid severity/dimension codes, status patterns, and evidence requirements.

**In Switchboard.** [`scripts/audit-validate-findings.ts`](scripts/audit-validate-findings.ts) splits on `## PREFIX-NN` headings (line 44), extracts the eight required fields (line 19-28), checks for `<...>` placeholders, validates `Severity` against `SEVERITIES` and `Dimension` against `DIMENSIONS`, matches `Status` against patterns like `Fixed (PR #\d+)`, and enforces evidence floors (Launch-blocker ≥2 types including File/Repro). A neat touch: it separately detects headings that _look_ like finding IDs but miss the canonical form (line 86, e.g. `## dc-01`), which would otherwise silently parse to zero findings.

**Gotcha.** The malformed-heading pass is the lesson: a parser that splits on a strict pattern will _silently_ drop anything slightly off-pattern, and "zero findings" reads as a clean audit. Always add a guard that catches near-misses.

### What to carry away

The whole pillar rests on three transferable habits. **Grade against live code** (every harness imports the real function). **Compute expectations from un-fudgeable facts** (the trajectory grader recomputes the mandate; the contract test asserts the injected `orgId` is dropped) so a test cannot pass by author intent. And **separate blocking from advisory deliberately** (deterministic eval tiers, the control-plane warn-only list, the demoted claim classifier) so the gate stays trustworthy and the noise stays out of it.

---

# Glossary

Terms a learner will hit throughout this curriculum.

- **WorkTrace**: The canonical, immutable, content-hashed audit row recording one governed work-unit submission from governance decision through execution outcome. It is the platform's core persistence object and the anchor for all lineage and integrity claims.
- **WorkUnit**: The in-memory request object (actor, intent, parameters, deployment, trust level) that enters `PlatformIngress.submit()`. Distinct from the WorkTrace, which is the durable audit record of what happened to it.
- **PlatformIngress**: The single mandatory entry point (`submit()`) for every mutating action. Funneling all writes through one method means idempotency, entitlement, governance, and audit are enforced in exactly one place with no bypass paths.
- **GovernanceGate**: The policy enforcement point (`evaluate()`) that judges every action before it runs, returning one of three outcomes: execute, require_approval, or deny.
- **Default-deny**: A fail-closed posture where the absence of an explicit allow is itself a denial. An action matching no seeded policy and not a trusted behavior is denied.
- **Deny-wins**: Policy composition rule: when multiple policies match, a single matched deny beats any number of allows regardless of priority order.
- **Idempotency key**: A value that identifies "the same request," used with a unique constraint as a distributed lock. Switchboard's WorkTrace key is org-scoped (`organizationId`, `idempotencyKey`).
- **Idempotency fingerprint**: A content hash (sha256 over sorted-key parameters) used by `IdempotencyGuard` at the propose() layer to dedup _before_ spending governance compute, distinct from the durable WorkTrace key.
- **P2002**: The Postgres/Prisma unique-constraint-violation error code. The "claim-first" idiom tries to insert and treats P2002 as "I lost the race," then reports, reads back, or no-ops depending on intent.
- **Content-addressed**: Identified by a hash of the content's own bytes (SHA-256 here). Stable content addressing requires deterministic (canonical) serialization.
- **Canonical JSON**: A deterministic serialization (an RFC 8785 subset) that sorts keys recursively and drops `undefined`, so the same logical object always hashes identically.
- **Hash chain**: An append-only, tamper-evident log where each entry stores its own content hash plus the previous entry's hash, so editing or deleting any historical entry breaks every link after it.
- **Audit anchor**: An audit-ledger entry whose snapshot witnesses a specific WorkTrace's `contentHash` and `traceVersion`, providing a second independent witness so tampering requires forging both the row and the hash-chained ledger.
- **Attribution tier**: One of five ordered rungs (`deterministic`, `high`, `medium`, `low`, `unattributed`) bucketing how hard the evidence is that a conversation caused revenue, snapshotted at receipt issuance.
- **sourceCount**: A monotonic counter of independent corroborating observations behind a learned fact. It only ever increases; confidence decays separately.
- **Confidence decay**: The scheduled reduction of a learned pattern's confidence when it has not been re-observed recently, floored so nothing decays to zero.
- **Decay window**: The age threshold (e.g. 90 or 180 days) past which an un-reinforced memory begins to decay.
- **TTL cache**: A time-to-live cache storing a value with an `expiresAt`, serving it until that timestamp passes; conceptually a decay window with a step function.
- **Freshness gate**: A binary or categorical recency check (fresh / stale / dead) over a timestamp, used to decide whether data is recent enough to act on.
- **NaN-blind comparison**: A recurring hazard: a raw `value > threshold` comparison is `false` for `NaN`, so a missing or unparseable external number silently passes a gate. The fix is a `Number.isFinite` guard before every external-numeric comparison.
- **PDPA**: The Personal Data Protection Act of Singapore (SG) and Malaysia (MY). Consent state is bound to one immutable jurisdiction per contact.
- **off / observe / enforce**: The three-mode staged rollout switch: `off` is zero-overhead pass-through, `observe` runs the full logic and emits telemetry without blocking, `enforce` actually blocks. It lets enforcement ship dark, then telemetry-only, then live.
- **Citation grounding**: Refusing to let an LLM assert a regulated fact unless that assertion can be traced to a pre-approved, dated source. The substantiation resolver grounds flagged sentences against approved or regulatory sources.
- **Trajectory grading**: Evaluating the ordered sequence of tool calls an agent run emitted, checking tool correctness, argument validity, and whether any call bypassed an approval gate, with the mandate recomputed from un-fudgeable facts.
- **Approval lifecycle**: The durable database-backed state machine (six states) that models human sign-off as persistent state rather than a UI callback, so an approval survives crashes and delays.
- **Binding hash**: A content hash over everything that defines an action, so an "approve" can prove the parameters did not silently change between display and execution.
- **ExecutableWorkUnit**: The frozen, materialized payload created at approval time. The dispatcher reads from it, never from live parameters, so an operator approves exactly what runs.
- **Dispatch-or-recovery**: The ordering invariant that after the authority commit, every later step fails _toward_ dispatch or a visible `recovery_required` state, never silently away from it.
- **executorBySlug**: A per-skill executor override in `SkillMode` so an internal agent like Mira runs on a zero-hook executor and the conversation governance gates never fire on an internal brief.
- **Effect category**: The declared risk class of a tool operation (`read`, `propose`, `simulate`, `write`, `external_send`, `external_mutation`, `irreversible`) that the governance policy matrix reasons over without understanding the operation itself.
- **Trust level**: The autonomy vocabulary (`supervised`, `guided`, `autonomous`) shared by the agent manifest, the agent context, and the governance policy matrix; it indexes which tool calls auto-approve versus require a human.
- **Skill / SKILL.md**: Agent behavior defined as a markdown file with YAML frontmatter (prompt-as-code), compiled by the skill loader. The frontmatter `slug` is the runtime identity and must equal the deployment's `skillSlug`.
- **system_auto_approved**: A fenced fast path that returns execute before the policy engine runs, guarded by the F4 static and D9-2 runtime financial-intent guards so it can never become a money-moving bypass.

---

# Where to go deeper

After this curriculum, read these in full to consolidate.

**Architecture and doctrine documents**

- `docs/ARCHITECTURE.md`: the deep architecture reference for the whole monorepo.
- `docs/DOCTRINE.md`: the architectural rules (mutating actions enter through `PlatformIngress.submit()`, `WorkTrace` is canonical persistence, approval is lifecycle state, no mutating bypass paths). Read this against the core invariants in `CLAUDE.md`.

**The most important source files to read end to end**

- `packages/core/src/platform/platform-ingress.ts`: the one front door; trace `submit()` from idempotency through governance to dispatch or park.
- `packages/core/src/platform/governance/governance-gate.ts` and `packages/core/src/engine/policy-engine.ts`: the policy enforcement point and the deterministic engine it orchestrates.
- `packages/core/src/platform/work-trace-hash.ts` and `work-trace-integrity.ts`: the canonical example of evolving a content hash without breaking history, plus the two-layer (recompute + anchor) integrity check. Study `EXCLUDED_BASE` and the two `hashInputVersion` shapes first.
- `packages/core/src/audit/ledger.ts` and `packages/db/src/storage/prisma-ledger-storage.ts`: the hash-chained ledger and the advisory-locked atomic append; re-derive on paper why the load-bearing parenthesis at `prisma-ledger-storage.ts:166-176` prevents cross-tenant cursor leakage.
- `packages/core/src/approval/respond-via-lifecycle.ts`: trace the ordering discipline after the authority commit (lines 124-217) to internalize the dispatch-or-recovery invariant.
- `packages/core/src/skill-runtime/skill-executor.ts`: the bounded agent loop, to see how much a production agent loop accretes.
- `packages/core/src/governance/classifier/substantiation-resolver.ts`: the tiered grounding and conservative paraphrase matcher.
- `evals/trajectory-grading/grade.ts`: the canonical example of computing an expectation from facts the author cannot fudge.

**Recommended path through the source**: follow one full action end to end with the file references above: inbound message to `PlatformIngress.submit()` to `GovernanceGate.evaluate()` to (execute or park). If parked: `createGatedLifecycle` to operator to `respondToParkedLifecycle` to `approveAndMaterialize` to `runDispatch`. At every step, find where the `WorkTrace` is written and how its integrity is preserved. That single trace exercises every pillar at once.
