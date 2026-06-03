# Mira Creative Loop: Canonical Roadmap (single workstream of record)

> Status: **workstream of record.** This document consolidates all in-flight and planned Mira
> creative work into one ordered workstream. It supersedes the "Mira Phase 0: Brain + Governance
> (Plan 1 of 5)" brain-first plan (see §6).
>
> Date: 2026-06-03. Base: `origin/main`. Author: Claude (autonomous session).
>
> Reconciles the phased roadmap in
> `docs/audits/2026-06-02-mira-audit-and-autonomous-ugc-vision/README.md` (P0 de-stub, P1 avatar,
> P2 publish, P3 learn, P4 brain) into a single **loop-first, brain-last** sequence (see §5).

## 1. Thesis: the governed loop is the product

Mira's differentiated product is **the governed closed loop**, not the generator:

```
generate  ->  publish (PAUSED)  ->  read live ROAS  ->  regenerate the winners
   ^                                                              |
   +------- Riley owns the revenue judgment that feeds back ------+
```

The frontier (Higgsfield, Creatify, HeyGen, Arcads) has commoditized creative _generation_:
finished talking-head UGC now costs roughly $0.65 to $2.15 per 30s clip at volume. Nobody closes
the performance loop (generate, publish to the ad account, read per-creative ROAS, regenerate the
winners) and nobody governs it. That open, governed loop is exactly what Switchboard is
architecturally built to own. The generator is a commodity to compose; the loop is the moat. Full
argument: `docs/audits/2026-06-02-mira-audit-and-autonomous-ugc-vision/README.md`.

**Division of labor.** Mira owns _creative_: brief, generation, QA, and the publish handoff. Riley
owns _revenue judgment_: which creative actually earned money, and therefore what is worth
remembering as a proven pattern. The two stay firewalled (see §4.2).

## 2. Current shipped state (verified against origin/main, 2026-06-03)

**The publish seam is built and 2 of its 3 go-live blockers are cleared.**

| Piece                                                                         | State                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation + spend through ingress                                            | **Shipped** (`creative.job.submit` / `.continue` / `.stop`, PRs #810 / #817 / #820). The spend-approval threshold is real for renders (#817).                                                                                           |
| Fake "Claude Vision" QA neutralized                                           | **Shipped** (#809). `evaluateRealism` is an honest stub returning `qaStatus:"requires_human_review"`; approval requires `qaStatus:"evaluated" && pass`. The real frame-QA plug point is set `qaStatus:"evaluated"` + `computeDecision`. |
| Governed publish seam (`creative.job.publish`)                                | **Shipped** (#830). On mandatory human approval, creates a self-contained **PAUSED** Meta draft package (campaign, ad set, ad creative, ad) for a complete + human-kept creative; persists `meta*` ids; activation is unreachable.      |
| Go-live blocker #1: durable asset storage                                     | **Cleared** (PR A, squash `4ad5b286`). `CreativeJob.durableAssetUrl` is populated at the polished `video-producer.ts` assembly seam.                                                                                                    |
| Go-live blocker #2: operator Page-id setter                                   | **Cleared** (PR C, #850). `PUT /api/connections/:id/meta-page-id` writes `credentials.pageId` on the org `meta-ads` Connection.                                                                                                         |
| Go-live blocker #3: async / dead-letter hardening                             | **In progress (slice 1 of this roadmap).** The inline Meta chain must move into a dead-lettered Inngest function before any pilot traffic.                                                                                              |
| Cockpit                                                                       | **Shipped.** `/mira` Director's Desk + `/mira/review` feed over `MiraCreativeReadModel` (real projection, not fixtures). Keep/Pass writes one `CreativeJob.reviewDecision` field via the firewalled `mira-decision` route.              |
| Per-creative attribution, `pastPerformance`, taste/revenue memory, Mira brain | **Not built.** `pastPerformance` is null at every producer; no taste-vs-revenue memory split exists; there is no Mira agent (no persona, SKILL.md, builder, tools, or memory).                                                          |

**Net:** the publish leg is one slice away from pilot-usable. The learn leg, the generator-quality
de-stub, and the brain are not started.

## 3. The decision (locked): one workstream, loop-first, brain-last

There is **one** Mira workstream, sequenced so that every later slice is informed by real signal the
earlier slices produce. Do not relitigate the ordering; do not run these in parallel as competing
workstreams.

### Slice 1: Make publish pilot-safe (finish P2) [in progress]

Move the inline Meta call chain (`uploadCreativeAsset` -> `createDraftCampaign` ->
`createDraftAdSet` -> `createAdCreative` -> `createAd`, all PAUSED) out of the synchronous
post-approval workflow handler and into a **dead-lettered Inngest function** with `step.run`
isolation per Meta object. This is go-live blocker #3.

- **Why now:** the handler currently runs in-band on the approval-response HTTP request, and
  `MetaAdsClient` self-rate-limits 60s per call across roughly 5 sequential calls, so a real publish
  would block the approver for minutes. The inline handler must not serve pilot traffic.
- **Shape:** the workflow handler dispatches an Inngest event and returns `outcome:"queued"` (the
  same pattern the `creative.job.submit` / `.continue` handlers already use); the new Inngest
  function does the Meta chain. Each created object id is a checkpoint persisted to the existing
  `CreativeJob.meta*` columns, so a retry resumes mid-chain with no orphaned or duplicate paused
  objects. Per doctrine #7, an `onFailure` handler records an `infrastructure.job.retry_exhausted`
  AuditLedger entry and emits a `creative.publish.failed` dead-letter event.
- **Invariant held:** activation stays unreachable (`updateCampaignStatus("ACTIVE")` still throws and
  is never called; `createAd` is PAUSED-only).
- **No schema change** (the `meta*` columns already exist from #830).

Spec for this slice: see the slice-1 design + plan committed alongside the implementation.

### Slice 2: Close the loop with learning (P3)

Make "this Mira creative earned $X at Y ROAS" answerable, and feed it back.

- **Per-creative attribution:** join the live ad's `metaVideoId` (the checkpoint column from #830 is
  the join key) to conversions / ROAS, and populate `CreativeJob.pastPerformance` (the designated
  channel, currently always null).
- **Two memories, kept separate (the crux):**
  - **Revenue-proven memory** is written only from _attributed performance_, and **Riley owns the
    promotion** of a pattern into it (Riley is the revenue authority; Mira does not self-certify that
    a creative "worked").
  - **Taste memory** is written from the operator's **Keep/Pass** gesture (subjective creative
    judgment). It informs the next brief but is **never** conflated with revenue-proven facts.
- **Ground against the real store.** The live `packages/db/src/stores/prisma-deployment-memory-store.ts`
  already exposes `listHighConfidence`, `findByCategoryAndCanonicalKey`, and `incrementConfidence`;
  the memory record carries `category` / `canonicalKey` / `confidence` / `sourceCount`. Today's
  categories are `preference | faq | objection | pattern | fact`. The taste-vs-revenue split is
  **greenfield** and must be designed against this real interface, not an assumed one.

### Slice 3: De-stub generator quality (P0 leftovers)

Make the existing pipeline tell the truth, now that the loop can measure which quality levers matter.

- **Real frame-QA:** send video keyframes as image content blocks to the VLM (today
  `realism-scorer.ts` sends a URL as a text string, so scores are hallucinated). Flip the plug point
  to `qaStatus:"evaluated"` + `computeDecision`.
- **Use the computed direction:** feed `SceneStyle` / `UgcDirection` (and a reference image) into the
  video prompt instead of raw `spec.script.text`.
- **Make UGC mode reachable** from Mira's brief/delegate entry points (drop the hardcoded
  `mode:"polished"`).
- The audit's **P1 (real avatar/spokesperson UGC via the HeyGen/Hedra seam, multi-provider routing,
  Veo 3.1 Fast)** folds in here as a refinement, prioritized by what the slice-2 loop shows actually
  moves performance, rather than built speculatively up front.

### Slice 4: Mira's brain (P4, last)

Only now, when the loop produces a real performance signal to reason over, give Mira an actual agent.

- **SKILL.md** mirroring `skills/alex/SKILL.md` (frontmatter: name/slug/intent/version/parameters/
  tools/context; sections: voice, boundaries, claim boundaries, flow, escalation).
- **A `miraBuilder`** mirroring `packages/core/src/skill-runtime/builders/alex.ts`
  (`alexBuilder(ctx, config, stores, services) => { parameters, injectedPatternIds }`), wired into the
  builder registry next to the other five builders.
- **DeploymentMemory** read at brief time (winning patterns enrich the next brief), **wired to a
  governed executor** over the real signal slices 2 and 3 produce. Mira can self-initiate briefs from
  performance signals and Riley handoffs.

## 4. Cross-cutting invariants (apply to every slice; not a phase)

1. **Build on the existing spine.** All mutating work flows through `PlatformIngress.submit()`,
   persists to `WorkTrace`, and runs long steps as **Inngest** functions. Do **not** introduce a
   parallel orchestration engine (LangGraph, Temporal, or similar): a second control plane violates
   doctrine invariant #1 (one control plane) and #2 (one lifecycle spine).
2. **Taste vs revenue-proven memory stay separate, and Riley owns promotion.** A Keep gesture is
   taste; only attributed revenue (Riley's judgment) promotes a pattern to revenue-proven. Never let a
   subjective Keep masquerade as proof that a creative earned money.
3. **Publish is paused-only; activation is human-gated.** `updateCampaignStatus("ACTIVE")` stays a
   hard throw; no symbol named `activate` / `goLive` / `publishLive` reaches Meta. Graduated autonomy
   may later relax _test-budget_ allocation, never claim review.
4. **Claim safety is human-gated at every trust tier.** Medspa/health-claim review (FTC
   substantiation, HIPAA) requires human sign-off on every creative, every time; the agent composes
   only from a pre-approved claim library and never invents claims. This is a hard gate, not a tier.
5. **Nothing ships built-but-unwired.** Every artifact lands with its live consumer in the same PR. A
   gate is inert until its producer populates the data; a builder is inert until an executor calls it.
   This codebase's recurring failure mode is the correctly-shaped seam that nothing calls (see
   `feedback_safety_gate_needs_producer_population`).

## 5. Reconciliation with the audit roadmap

The audit (`.../2026-06-02-mira-audit-and-autonomous-ugc-vision/README.md`) ordered the work by
"improve the drafts first": P0 de-stub, P1 avatar, P2 publish, P3 learn, P4 brain. This roadmap keeps
the same six gaps but **resequences to loop-first**:

| Audit phase           | This roadmap         | Why the reorder                                                                                                            |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P2 publish            | **Slice 1** (finish) | The loop is the product. The publish leg is nearly done; finishing it makes the ROI claim _possible_ before anything else. |
| P3 learn              | **Slice 2**          | Measurement closes the loop. With publish live, per-creative ROAS becomes the real signal every later slice needs.         |
| P0 de-stub, P1 avatar | **Slice 3**          | Generator quality is prioritized by what the _measured_ loop shows matters, not by speculation. Avatar UGC folds in here.  |
| P4 brain              | **Slice 4**          | The brain is built last, wired to the real performance signal slices 2 and 3 produce, never blind.                         |

The reorder is a direct application of invariant #5: build each capability _after_ the thing that
gives it real signal exists, so nothing ships built-but-unwired.

## 6. Superseded: the brain-first plan (do not resurrect)

A prior "Mira Phase 0: Brain + Governance (Plan 1 of 5)" plan proposed building Mira's brain
(SKILL.md, builder, memory) **first**. It is rejected for two grounded reasons:

1. **It builds the brain blind.** With no publish loop and no attribution, the brain has no real
   performance signal to reason over; it would be another built-but-unwired artifact, the exact
   anti-pattern invariant #5 exists to prevent. The brain must come last, after the loop produces
   signal.
2. **It violates the `mira-decision` firewall.** The plan bolted a memory write onto the
   `mira-decision` route. That route (`apps/api/src/routes/agent-home/mira-decision.ts`,
   `// @route-class: lifecycle`) is verified to be a single-field `reviewDecision` setter, explicitly
   firewalled from Riley, recommendations, campaigns, and publish. A memory write there breaks its
   contract.

**Its good parts are redistributed, not discarded:**

- **Taste-capture** moves to **slice 2**, grounded against the real
  `prisma-deployment-memory-store.ts` interface (not an assumed one).
- **SKILL.md + the builder** move to **slice 4**, wired to a governed executor. The real templates to
  mirror are `skills/alex/SKILL.md` and `packages/core/src/skill-runtime/builders/alex.ts` (both
  confirmed present).

(Note: an earlier characterization of the brain-first plan claimed its `DeploymentMemory` interface
did not match the live store. That claim does not hold against `origin/main`: the live store already
exposes `listHighConfidence` / `findByCategoryAndCanonicalKey` / `incrementConfidence`. The two
reasons above are the real ones.)

## 7. Open questions deferred to each slice's own spec

- Slice 2: the exact attribution join (CAPI event shape carrying the creative id) and the
  taste/revenue category names + confidence-update rules.
- Slice 3: avatar provider selection and the multi-provider routing seam.
- Slice 4: Mira's tool set, the governed executor binding, and the self-initiation trigger.

Each slice lands its own spec + plan as a focused PR to `main` (per the branch/worktree doctrine),
consumes the specs already on `main`, and ships with its live consumer.
