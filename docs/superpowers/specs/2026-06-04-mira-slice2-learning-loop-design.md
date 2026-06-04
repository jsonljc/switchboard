# Mira Slice 2: Close the Loop with Learning (per-creative attribution + the two-memory split)

> Status: design spec for slice 2 of the canonical Mira roadmap
> (`docs/superpowers/specs/2026-06-03-mira-roadmap.md`, PR #858). Consumes that roadmap; resolves
> its section-7 open questions for slice 2.
>
> Date: 2026-06-04. Base: `origin/main` @ `055a2100`. Author: Claude (autonomous session).

## 1. Goal

Make "this Mira creative earned $X at Y ROAS" answerable, and feed it back into the next brief.
Two legs, per the roadmap:

1. **Per-creative attribution.** Join the published ad (the `CreativeJob.metaVideoId` /
   `metaCampaignId` checkpoint columns persisted by the slice-1 publish path) to live performance,
   and populate `CreativeJob.pastPerformance` (the designated channel, null at every producer
   today).
2. **Two memories, never conflated.** TASTE memory written from the operator Keep/Pass gesture
   (subjective, live signal exists today). REVENUE-PROVEN memory written only from attributed
   performance, where Riley owns promotion (Mira never self-certifies that a creative "worked").

No Mira ad has served yet (pilot is blocked on Meta gates), so attribution lands as plumbing
proven by TDD against the real interfaces with seeded/mocked insights. Section 9 states exactly
what flips it live (nothing: the moment an operator activates a parked ad in Ads Manager, the
sweep starts measuring).

## 2. Verified current state (grounded against origin/main @ 055a2100, 2026-06-04)

| Fact                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish creates a DEDICATED paused campaign per creative (1:1 campaign:creative)                                                                                                                                                                                                                                                                | `apps/api/src/services/creative-publish-function.ts` walks upload, campaign, ad set, creative, ad per job; checkpoints persisted via `PrismaCreativeJobStore.updatePublishFields` (`packages/db/src/stores/prisma-creative-job-store.ts:150`) |
| `CreativeJob.pastPerformance` is `Json?`, typed `z.record(z.unknown()).nullable()`, written only as a brief passthrough at job creation, read by nothing                                                                                                                                                                                        | `packages/db/prisma/schema.prisma` (CreativeJob), `packages/schemas/src/creative-job.ts:224`, `apps/api/src/services/workflows/creative-job-submit-workflow.ts:47`                                                                            |
| The pipeline runner's stage brief omits `pastPerformance` entirely                                                                                                                                                                                                                                                                              | `packages/creative-pipeline/src/creative-job-runner.ts:79-86`                                                                                                                                                                                 |
| Campaign insights are an account-level read returning every campaign in one rate-limited call (60s self-limit) with campaignId, spend, impressions, clicks, conversions, ctr, cpm                                                                                                                                                               | `packages/ad-optimizer/src/meta-ads-client.ts:101-126`, `mapCampaignInsight` at `:425`                                                                                                                                                        |
| No per-ad or per-video insights read exists anywhere; `creative-analyzer` is a pure function whose `RawAdData` input nothing live assembles                                                                                                                                                                                                     | `packages/ad-optimizer/src/creative-analyzer.ts:35`, tool wrapper takes pre-built entries (`apps/api/src/tools/ad-optimizer/ads-analytics.ts:135-159`)                                                                                        |
| Internal booked value per campaign already exists: `queryBookedValueCentsByCampaign({orgId, from, to, campaignIds?}) -> Map<campaignId, cents>`                                                                                                                                                                                                 | `packages/db/src/stores/prisma-conversion-record-store.ts:224-251`                                                                                                                                                                            |
| `ConversionRecord.value` is CENTS; cents normalize to major units ONLY via `normalizeConversionValue`                                                                                                                                                                                                                                           | `packages/ad-optimizer/src/conversion-value.ts:9-11`, `analyzers/source-comparator.ts:61-64`                                                                                                                                                  |
| DeploymentMemory categories are `z.enum(["preference","faq","objection","pattern","fact"])`; the Prisma column is `String` (no migration to add values); the store exposes create / incrementConfidence / listHighConfidence / findByCategory / findByCategoryAndCanonicalKey / countByDeployment / findEvictionCandidate / delete / decayStale | `packages/schemas/src/deployment-memory.ts:7-13`, `packages/db/prisma/schema.prisma` (DeploymentMemory), `packages/db/src/stores/prisma-deployment-memory-store.ts`                                                                           |
| Confidence mechanics: `computeConfidenceScore = ownerConfirmed ? 1.0 : min(0.95, 0.5 + 0.15 ln(sourceCount))`; surfacing threshold 0.66 confidence / 3 sources; 500-entry cap with lowest-confidence eviction; daily decay cron                                                                                                                 | `packages/schemas/src/deployment-memory.ts:70-76`, `packages/core/src/memory/inngest-functions.ts:38-62`                                                                                                                                      |
| `DeploymentMemoryCategorySchema` has zero consumers outside `packages/schemas` itself; store interfaces take plain `category: string`; context-builder's binary checks compare against the literal `"pattern"`                                                                                                                                  | grep of `DeploymentMemoryCategorySchema`; `packages/core/src/memory/context-builder.ts:179,204`                                                                                                                                               |
| Alex's conversation extractor casts (`JSON.parse(raw) as ExtractionResult`), it does not zod-parse against the category enum; its prompt hardcodes the five legacy categories                                                                                                                                                                   | `packages/core/src/memory/compounding-service.ts:327`, `packages/core/src/memory/extraction-prompts.ts:43`                                                                                                                                    |
| Keep/Pass producer is the firewalled `mira-decision` route: org-scoped `updateMany` writing ONLY `reviewDecision` ("kept" / "passed" / null un-keep) + `reviewDecidedAt`                                                                                                                                                                        | `apps/api/src/routes/agent-home/mira-decision.ts:57-62`                                                                                                                                                                                       |
| Hooks carry a structured 3-value archetype enum (`pattern_interrupt`, `question`, `bold_statement`); scripts reference hooks via `hookRef`; the assembled video is a composite (all storyboards' scenes, all scripts joined into one voiceover)                                                                                                 | `packages/schemas/src/creative-job.ts:31,61-69,86-105`, `packages/creative-pipeline/src/stages/video-producer.ts:107-158`                                                                                                                     |
| Per-org async sweeps follow the dispatch + worker Inngest pair pattern with doctrine-#7 onFailure                                                                                                                                                                                                                                               | `riley-outcome-attribution-dispatch` / `-worker` (`packages/ad-optimizer/src/inngest-functions.ts:439-471`, registered in `apps/api/src/bootstrap/inngest.ts`)                                                                                |
| System-initiated submits use the seeded `{id:"system", type:"system"}` principal; derived-data writes (publish checkpoints, RecommendationOutcome rows, read models) are direct store writes, not ingress                                                                                                                                       | `apps/api/src/services/workflows/recommendation-handoff-request.ts`, `creative-publish-function.ts`                                                                                                                                           |

## 3. Decisions (resolving roadmap section 7 for slice 2)

### 3.1 The attribution join: dedicated-campaign 1:1, not video_id breakdowns

Slice-1 publish creates a self-contained paused campaign per creative. Campaign-level metrics ARE
per-creative metrics for every Mira-published ad. So the join is:

```
CreativeJob (metaCampaignId != null)
  -> Meta side:    ONE account-level getCampaignInsights call per org (existing method,
                   60s self-rate-limited), filtered client-side to the published campaign ids
  -> booked side:  queryBookedValueCentsByCampaign({orgId, from, to, campaignIds}) (existing)
                   plus a sibling booked-count aggregate (new, same groupBy shape)
```

`metaVideoId` stays the durable creative identity (it is the dedup key `creative-analyzer` uses
and the only id that survives campaign restructuring); it is recorded inside `pastPerformance`
as part of the join identity but is not the query key in slice 2.

**Rejected: a new ad-level / video_id-breakdown insights method.** Strictly more Meta surface for
zero additional truth while campaigns are 1:1. The spec records the constraint instead: if a
future slice consolidates multiple creatives into shared campaigns, the join MUST move to
ad-level insights (`level: "ad"`, join on `metaAdId`), and `pastPerformance.join` already carries
`metaAdId` for that migration.

**Rejected: CAPI-event creative ids.** CAPI conversions are account/pixel-level with no creative
id (verified in the 2026-06-02 audit); the internal `ConversionRecord.sourceCampaignId` is the
honest revenue source, and it is already per-creative thanks to the 1:1 campaign.

### 3.2 Where it runs: a dead-lettered Inngest dispatch + worker pair (daily)

Mirrors `riley-outcome-attribution-dispatch` / `-worker`:

- `creative-attribution-dispatch` (cron `30 6 * * *`): one system-level query for distinct
  organizations having at least one `metaCampaignId != null` CreativeJob, then one
  `creative-pipeline/attribution.refresh` event per org. Read-only.
- `creative-attribution-worker` (event `creative-pipeline/attribution.refresh`): per-org. Loads
  that org's published jobs, resolves the org `meta-ads` Connection credentials exactly the way
  `creative-publish-function.ts` does (decrypt at run time, never serialized into step state),
  makes the single insights call, the booked aggregates, computes one `PastPerformance` object
  per job, persists via the new org-scoped setter.
- Doctrine #7: the worker registers `onFailure` via `makeOnFailureHandler` recording
  `infrastructure.job.retry_exhausted`. Risk class mirrors the Riley attribution worker (LOW,
  read-side projection, no spend): audit entry always, no operator alert, no domain failed event
  (Class E: no downstream consumer of a failure event exists).
- Missing credentials, no published jobs, or no insights rows are graceful no-ops, not failures.

**Rejected: one serial cron over all orgs** (the weekly-audit shape): no per-org failure
isolation; one org's Meta error would burn retries for every org.

**Rejected: a governed intent through PlatformIngress.** Populating `pastPerformance` is a
projection of external measured reality onto an already-governed record, the same write class as
the publish function's `meta*` checkpoint columns and Riley's `RecommendationOutcome` rows, which
are direct store writes by established convention. No business decision is taken; nothing spends;
nothing reaches Meta mutatively.

### 3.3 The `pastPerformance` shape (typed, versioned, dual-source)

New in `packages/schemas/src/creative-job.ts` (L1):

```ts
export const CreativePastPerformanceSchema = z.object({
  version: z.literal(1),
  asOf: z.string(), // ISO timestamp of the sweep
  window: z.object({ from: z.string(), to: z.string(), days: z.number().int() }),
  delivery: z.enum(["no_delivery", "measured"]),
  join: z.object({
    metaCampaignId: z.string(),
    metaAdId: z.string().nullable(),
    metaVideoId: z.string().nullable(),
  }),
  meta: z.object({
    // Meta-attributed, major currency units as Meta reports
    spend: z.number(),
    impressions: z.number(),
    inlineLinkClicks: z.number(),
    inlineLinkClickCtr: z.number(),
    conversions: z.number(), // Meta-attributed conversions, NOT internal truth
    cpm: z.number(),
  }),
  booked: z.object({
    // internal source of truth
    valueCents: z.number().int(), // CENTS, never pre-normalized
    count: z.number().int(),
  }),
  trueRoas: z.number().nullable(), // normalizeConversionValue(valueCents) / meta.spend; null when spend == 0
  source: z.object({
    insights: z.literal("meta_campaign_insights"),
    conversions: z.literal("conversion_records"),
  }),
});
```

Rules:

- The two sources stay labeled (`meta.conversions` vs `booked.count`): the Riley arc's dual-source
  lesson. Nothing averages or merges them.
- Cents convert to major units ONLY inside the `trueRoas` computation, via the existing
  `normalizeConversionValue`. `booked.valueCents` is stored as cents.
- `delivery: "no_delivery"` (spend == 0 and impressions == 0) is the expected state for every
  parked ad until an operator activates it in Ads Manager. Writing it is honest and makes the
  cockpit story true ("published, not yet delivering").
- Window: from the earliest published job's `createdAt` (clamped to the last 90 days) to now, one
  window per org so the insights call stays single. Pilot-correct; the clamp is documented and
  revisited when any creative has more than 90 days of delivery history.
- The existing `CreativeBriefInput.pastPerformance` stays `z.record(z.unknown()).nullable()` at
  ingest (callers may pass arbitrary context); the TYPED schema governs what the attribution
  sweep writes and what the read model and brief enrichment parse (parse-do-not-cast, skip rows
  that fail).

Persistence: new `PrismaCreativeJobStore.setPastPerformance(organizationId, id, performance)`,
org-scoped `updateMany` with a `count === 0` guard (per `feedback_updatemany_drops_nomatch_abort`),
plus a query method for published jobs (`listPublished(organizationId)`: `metaCampaignId != null`).

### 3.4 The two new memory categories

`packages/schemas/src/deployment-memory.ts` gains two enum values (L1 change, no Prisma migration:
the column is `String`):

| Category         | Written by                                                                    | Meaning                                                                       |
| ---------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `taste`          | The taste sweep (slice 2, this spec)                                          | The operator's subjective Keep/Pass judgment, bucketed by creative descriptor |
| `revenue_proven` | Riley-owned promotion ONLY (designed here, built when triggered; section 3.7) | A creative pattern with attributed revenue evidence behind it                 |

Consumer sweep performed (the #860 lesson: new enum values get silently swallowed by binary
assumptions downstream):

- `DeploymentMemoryCategorySchema` has no zod consumers outside schemas; store interfaces take
  `category: string`.
- `context-builder.ts:179,204` compares against the literal `"pattern"`: taste/revenue_proven rows
  would flow into the "fact-like" branch, but only for the deployment being prompted. Alex's
  context builder reads Alex's deployment; Mira's memories live on Mira's creative deployment, so
  there is no crossover. Documented, and PR-B adds a regression test pinning that taste rows on
  the creative deployment never surface in a conversation-context build for another deployment.
- `extraction-prompts.ts:43` (Alex's conversation extractor) intentionally does NOT gain the new
  categories: conversation extraction must never emit `taste` or `revenue_proven`. The extractor
  output is cast, not enum-parsed (`compounding-service.ts:327`), so widening the schema enum does
  not widen what the extractor accepts.
- The deployment-memory API route already accepts `category: z.string()`; no exposure change.

### 3.5 Taste memory: canonicalKey grammar, content, confidence

The gesture is binary (kept / passed) on a composite video. The deterministic, bounded descriptor
available today is the creative's mode and leading hook archetype:

- **canonicalKey:** `taste:{kept|passed}:{mode}:{hookType}`, e.g. `taste:kept:polished:question`.
  Bounded vocabulary: 2 decisions x 2 modes x 3 hook types = at most 12 buckets per deployment.
  Polarity lives in the KEY (separate kept and passed buckets) because DeploymentMemory has no
  negative-evidence counter; `sourceCount` only grows. Readers compare bucket pairs.
- **Descriptor extraction** (pure function in `packages/creative-pipeline`, exported; tested):
  leading hook = `stageOutputs.scripts.scripts[0].hookRef` resolved against
  `stageOutputs.hooks.hooks[]`; fallback chain `topCombos[0].hookRef`, then `hooks[0]`; if no hook
  stage output exists (e.g. UGC mode v1), the hookType segment becomes the literal `none`
  (`taste:kept:ugc:none`). The assembled video is a composite of all scripts; the LEADING hook is
  the one that opens the video, which is the gesture's strongest signal. Documented limitation,
  acceptable for v1.
- **Content** (human-readable, for the memory surfaces and future prompt rendering):
  `Operator kept a polished creative with a question hook ("<hook text, truncated>")`.
- **Confidence:** the standard curve. First observation creates at 0.5; each repeat observation of
  the same canonicalKey goes through `incrementConfidence(computeConfidenceScore(sourceCount + 1))`.
  Surfacing uses the existing thresholds (0.66 confidence, 3 sources): taste only shapes briefs
  after three consistent gestures on the same bucket. No new tuning knobs.
- **Re-decisions:** each sweep observation of a changed decision is a new gesture observation
  (kept then later passed increments both buckets over time). Un-keep (null) produces no
  observation and does not retract prior ones; memories record observation history, not current
  state. Documented.

### 3.6 The Keep/Pass capture seam: a watermarked sweep, not a route change

New nullable column `CreativeJob.tasteCapturedAt DateTime?` (migration required, hand-written via
`prisma migrate diff --script`). New dead-lettered Inngest cron `creative-taste-sweep` (daily,
`0 6 * * *`, before the attribution dispatch):

```
jobs = WHERE reviewDecision != null AND (tasteCapturedAt == null OR reviewDecidedAt > tasteCapturedAt)
for each job (org-scoped):
  descriptor = extractCreativeDescriptor(stageOutputs, mode)
  upsert memory on the job's deploymentId:
    existing = findByCategoryAndCanonicalKey(org, deployment, "taste", key)
    existing ? incrementConfidence(...) : create({category: "taste", canonicalKey: key, confidence: 0.5})
    (respect the 500-entry cap exactly like compounding-service: countByDeployment +
     findEvictionCandidate, evict only if the newcomer beats the candidate)
  setTasteCapturedAt(org, job.id, now)   // the idempotency watermark
```

Why a sweep:

- **The route stays byte-untouched.** `mira-decision.ts` is explicitly firewalled (the rejected
  brain-first plan's sin was bolting a memory write into it). The `reviewDecision` +
  `reviewDecidedAt` columns ARE the durable event record; the table is the queue.
- **Idempotent and self-healing.** The watermark (`tasteCapturedAt`) makes re-runs and missed days
  converge; a crashed sweep re-picks the same rows.
- **Rejected: outbox.** Today's `OutboxPublisher` drains into the ConversionBus specifically
  (OutboxEvent maps to ConversionEvent); generalizing it to arbitrary domain events is a bigger
  change than slice 2 needs.
- **Rejected: a governed intent per gesture.** The gesture is a human verdict already captured on
  a lifecycle surface; the memory write is a derived projection of stored state. DeploymentMemory
  writes today (compounding-service after conversation end) are not ingress-governed either; this
  follows the established convention.
- **Latency is acceptable:** taste influences the NEXT brief; briefs are operator-cadence events,
  not real-time.

### 3.7 Revenue-proven memory and the Riley promotion contract (designed now, built on trigger)

**Design (binding for the future PR):**

- **Writer location:** Riley-owned code only. The promotion check runs inside the existing
  `riley-outcome-attribution-worker` per-org pass (Riley's cron already owns outcome attribution).
  Mira-side code never writes `revenue_proven`; the spec-level invariant is that the only call
  site of a `revenue_proven` create/increment lives in Riley-owned modules, with a test pinning
  it.
- **Promotion criteria (evidence floors, all required):** the creative's `pastPerformance` has
  `delivery: "measured"`, `meta.spend >= 50` (USD major units), `booked.count >= 2`, and
  `trueRoas >= 1.5`, AND Riley's account substrate does not abstain (`measurementTrusted` true and
  signal health not red, read from the same RevenueState producers the audit uses). Floors are
  constants reviewed when the first real cohort exists.
- **canonicalKey:** `revenue_proven:{mode}:{hookType}` (the same descriptor grammar as taste,
  WITHOUT polarity: only wins are promoted; losses are Riley recommendation territory, not
  memory).
- **Content carries provenance:** jobId, metaCampaignId, metaVideoId, window, spend, bookedValue,
  trueRoas at promotion time. A revenue_proven memory must be traceable to the attributed rows
  that earned it.
- **Confidence:** created at 0.5 on first promotion, standard curve per additional qualifying
  creative in the same bucket. Riley promoting a bucket twice means two independently attributed
  winners.
- **Consumer:** brief enrichment reads `revenue_proven` the same way it reads `taste` (section
  3.8) but renders it under a separate "revenue-proven patterns (attributed)" heading. The reader
  for `revenue_proven` ships WITH the promotion PR, not before.

**Build trigger (explicit):** the first CreativeJob whose `pastPerformance` reaches
`delivery: "measured"` with `meta.spend > 0`. Until then this section is the contract; slice 2
ships only the category vocabulary and this design. Building the promotion path before any
attributed data exists would be exactly the built-but-unwired anti-pattern invariant #5 forbids.

### 3.8 Feeding it back: the brief enrichment + prompt injection (the live consumers)

Two consumer legs, one per channel, never conflated:

**Measured channel (PR-A's data, consumed in PR-B):** `creative-job-submit-workflow` (and only
it; the concept-draft workflow is draft-only and fires no pipeline) enriches at job creation:
when `brief.pastPerformance` is null, aggregate the deployment's attributed history (top
performing measured creatives by trueRoas, capped at 3, plus a one-line summary) into the typed
shape's sibling `CreativePerformanceHistorySchema` and persist it as the new job's
`pastPerformance`. The runner then passes `job.pastPerformance` into the stage brief
(`creative-job-runner.ts` brief assembly) and `buildTrendPrompt` / hook-generator render a
"PAST PERFORMANCE (measured)" block when present. Callers that already pass explicit
`pastPerformance` win over enrichment.

**Taste channel (PR-B):** the runner gains an injected, optional `creativeMemoryProvider`
(interface owned by `packages/creative-pipeline`, implemented in `apps/api`, injected from
`bootstrap/inngest.ts`; the exact layering precedent of `AssetStorageClient` from the durable-
asset PR). Provider: `getTasteContext(organizationId, deploymentId)` returning high-confidence
taste buckets (via `listHighConfidence` + category filter, standard thresholds). The trend and
hook prompts render it as a clearly subjective block: "OPERATOR TASTE (subjective, from review
gestures): consistently keeps question hooks in polished mode (4 keeps)". Absent provider or
empty memories renders nothing (degrade-gracefully, dev parity).

Channel separation is enforced by shape: measured history lives in `pastPerformance` (numbers,
source-labeled), taste lives in memory rendered under a subjective heading. No code path merges
them into one structure.

### 3.9 Answerability: the read model surfaces measured performance (PR-A's consumer)

`MiraCreativeJobSummary` gains an optional `performance` projection (asOf, delivery, spend,
trueRoas, bookedValueCents, conversions source-labeled), populated by parsing
`CreativeJob.pastPerformance` with the typed schema (parse failures project nothing). Surfaced on
the detail projection (`GET /agents/mira/creatives/:id`) and rendered in the existing /mira
detail surface as a compact "Performance" block ("No delivery yet" for `no_delivery`). The feed
stays light. This is the "answerable" leg: the operator can see what a published creative earned
without leaving the desk.

## 4. PR plan (each producer ships with its live consumer)

**PR-A: `feat(api): per-creative attribution sweep populating pastPerformance`**

- L1: `CreativePastPerformanceSchema` in `packages/schemas`.
- L2: the `creative-pipeline/attribution.refresh` event type in
  `packages/creative-pipeline/src/inngest-client.ts`.
- L4: `PrismaCreativeJobStore.setPastPerformance` + `listPublished`; booked-count sibling
  aggregate on `PrismaConversionRecordStore` (new method, existing one untouched).
- L5: `creative-attribution-dispatch` + `creative-attribution-worker` Inngest pair with
  doctrine-#7 onFailure; credential resolution mirroring the publish function.
- Consumer: read-model `performance` projection + detail-route exposure + minimal dashboard
  detail block.
- No Prisma migration (column exists). No new env vars. No governance change (no new intents).
- Tests: worker unit tests with mocked step tools + mocked ads client (real interfaces);
  store tests mirroring `prisma-workflow-store.test.ts` mocked-Prisma style; cents/major boundary
  test (trueRoas from cents fixtures); no_delivery classification; idempotent re-sweep
  (overwrite, not append); org isolation (cross-org rows never touched); read-model projection
  parse-failure tolerance.

**PR-B: `feat(api): taste memory from Keep/Pass + brief feed-back loop`**

- L1: `taste` + `revenue_proven` enum values; `CreativePerformanceHistorySchema` (the enriched
  shape new briefs carry); descriptor types if shared.
- Migration: `CreativeJob.tasteCapturedAt DateTime?` (hand-written, same commit as schema change).
- L2 (`creative-pipeline`): pure `extractCreativeDescriptor`; `creativeMemoryProvider` interface;
  trend/hook prompt blocks (taste + measured history); runner brief gains `pastPerformance` +
  provider threading.
- L5: `creative-taste-sweep` cron (dead-lettered) writing taste memories with cap/eviction
  semantics; submit-workflow enrichment producing measured history for new jobs; provider
  implementation injected from bootstrap.
- Tests: sweep idempotency via watermark; re-decision and un-keep semantics; descriptor fallback
  chain; cap eviction parity with compounding-service; enrichment aggregation (skips unparseable
  rows, caps at 3, explicit-brief wins); prompt rendering includes the blocks only when data
  exists; the cross-deployment regression test from section 3.4; conversation-extractor prompt
  unchanged.

Sequencing: PR-A merges first (PR-B's enrichment aggregates PR-A's rows; PR-B degrades to
no-blocks when zero attributed rows exist, so it is not hard-blocked, but review is cleaner in
this order). Both PRs are focused branches off main, not a stacked pair.

## 5. Invariants held (cross-cutting, from the roadmap)

1. **Existing spine only.** Inngest functions + direct projection writes by established
   convention; no new orchestration engine; no new ingress intents needed (nothing here is a new
   business mutation: the gesture is already captured, attribution is measurement).
2. **Taste vs revenue-proven never conflated; Riley owns promotion.** Separate categories,
   separate writers (sweep vs Riley-owned promotion), separate prompt blocks, polarity-keyed
   taste buckets, provenance-carrying revenue_proven content, test-pinned writer location.
3. **Paused-only publish untouched.** Slice 2 only READS Meta (one insights call); no
   publish-path file changes; activation remains unreachable.
4. **Claim safety untouched.** No claim-bearing surfaces change.
5. **Nothing built-but-unwired.** PR-A: sweep (producer) + read-model/detail (consumer). PR-B:
   sweep + enrichment (producers) + prompt injection (consumers). Revenue-proven promotion:
   DESIGNED with an explicit build trigger, zero half-built code (vocabulary only).

## 6. Risks and mitigations

| Risk                                                                                               | Mitigation                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The 1:1 campaign assumption silently breaks if a future slice consolidates campaigns               | Constraint documented here and as a comment on the worker's join; migration path (ad-level insights on `metaAdId`) pre-named in 3.1                                                 |
| New enum values swallowed by downstream binaries (the #860 class)                                  | Consumer sweep done (3.4); regression tests in PR-B; extractor prompt pinned unchanged                                                                                              |
| Insights call rate-limit contention with Riley's crons (shared 60s client self-limit per instance) | Separate client instances per function run (the client is constructed per run, limit is per-instance); daily cadence; one call per org                                              |
| Parked ads produce all-zero metrics forever if never activated                                     | `delivery: "no_delivery"` is a first-class honest state surfaced in the cockpit, not an error                                                                                       |
| Taste sweep writes on a deployment at the 500-entry memory cap could evict conversation facts      | Taste uses the same cap-admission policy as compounding-service (evict only when the newcomer beats the lowest-confidence candidate); at most 12 taste buckets exist per deployment |
| `pastPerformance` rows written by older sweeps with a future schema v2                             | `version` literal + parse-do-not-cast at every reader; unparseable rows project nothing                                                                                             |

## 7. What flips it live

Nothing in this slice gates on deployment flags. The sweep is live at merge: the day an operator
activates a parked Mira ad in Ads Manager (the human-gated step outside this system), the next
daily run records real delivery, `delivery` flips to `measured`, the detail block shows earned
dollars and trueROAS, and enrichment starts citing it. The Riley promotion PR (3.7) is the only
deferred build, with its trigger defined.

## 8. Out of scope (deferred by the roadmap, not by omission)

- Generator quality (real frame-QA, SceneStyle/UgcDirection into prompts, UGC reachability):
  slice 3.
- Avatar/multi-provider routing: slice 3.
- Mira's brain (SKILL.md, builder, governed executor, self-initiated briefs): slice 4.
- Ad-level insights client surface: only when campaigns stop being 1:1.
- Operator-facing taste/memory management UI: post-slice-2 backlog.
