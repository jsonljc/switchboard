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
