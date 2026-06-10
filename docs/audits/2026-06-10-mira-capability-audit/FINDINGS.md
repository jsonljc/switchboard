# Mira Capability Audit: Findings and Prioritized Backlog

**Date:** 2026-06-10
**Baseline:** `origin/main` @ `84083f0c` (post-F-15, #958)
**Subject:** Mira = the creative agent (deployment skillSlug `creative`): `packages/creative-pipeline/` (polished + UGC engines), its `packages/core` surfaces (skill-runtime builder, creative read model, taste memory, agent-home), the api crons and workflows (self-brief, taste sweep, attribution, handoff, publish), the `/mira` desk, and the governed publish seam.
**North star:** a bespoke AI revenue operator for SG/MY aesthetic clinics that book on WhatsApp. Riley diagnoses spend, Mira turns diagnosis and funnel reality into winning creative, publish runs governed (PAUSED, human-approved), Alex books the conversations the ads start, and the loop reallocates toward what pays. Synergy across the three agents is the moat.
**Method:** 9 parallel domain auditors + 2 web researchers, then one adversarial verifier-corrector per domain (refute-by-default on every P0/P1), a completeness critic with a producer-to-consumer seam matrix, and 5 gap-closure agents on the seams the domain split missed. Roughly 6.5M subagent tokens. Every claim cites `file:line` from live code; 120 findings survived verification (2 P0, 38 P1, 72 P2, 8 OPP), zero were refuted outright. Full per-domain evidence in [`domains/`](./domains/), market and policy research in [`research/`](./research/).

---

## 0. How to read this

This is decision support for one question: _what do we do next so Mira earns her place in the revenue loop?_ It is deliberately opinionated about sequence.

- **§1** the one-paragraph thesis.
- **§2** current state by layer, with evidence.
- **§3** the meta-finding: _assembled, never energized, and silent about it._ The most important section.
- **§4** cross-cutting themes.
- **§5** the prioritized backlog (the actionable part).
- **§6** recommended sequence.
- **§7** reconciliation with the 2026-06-03 roadmap: what actually shipped vs what the roadmap recorded.
- **§8** verification log.
- **§9** open decisions for you.

---

## 1. Thesis

**The cage is excellent; the animal has never breathed.** The governance spine around Mira is real and verifiably sound: every spend-capable path enters `PlatformIngress.submit()`, publish parks behind a mandatory human approval with binding-hash integrity, every Meta object is created PAUSED with activation structurally unreachable, and approve ends in dispatch-or-recovery (D4, G1). But the loop inside that cage has never run end to end, and almost every break fails silently:

1. **Generation is dead on arrival.** Every LLM stage calls a nonexistent model id, so trends, hooks, scripts, storyboard, UGC scripting, and frame QA all 404 against the live API (D1-F1). The operator's production-tier choice never survives the Inngest-memoized snapshot, so pro assembly, durable assets, and polished publishability are unreachable (D1-F2). A render that produces zero clips completes as success (D1-F4).
2. **The publish leg points away from the wedge.** The draft package is lead-form shaped (`OUTCOME_LEADS`, placeholder link, no WhatsApp destination, no `WHATSAPP_MESSAGE` CTA), Meta objectives are immutable post-create, and required Graph params are missing, so the first live publish likely dead-letters with alerting off (G3-F1/F2, D9-F3).
3. **The receipted-bookings join has no producer.** `ConversionRecord.sourceCampaignId` is never populated on the CTWA path (`resolveCampaignId` unwired, `getAdCampaignId` has zero callers), so booked revenue can never credit a Mira campaign: the product's headline number is structurally absent for the exact market it targets (G2-F1, G3-F3).
4. **The brain is dark and the memory is half-built.** Self-brief and enrichment flags default off, the governance install exists only for `org_dev`, concept drafts are inert rows no surface can advance, and `revenue_proven` memory has zero writers while Mira's builder reads it first (D3, D6-F2/F3, D8-F3).
5. **Nobody would know.** Production alerting resolves to a no-op (webhook set nowhere), failed renders read `awaiting_review` forever, the desk narrates dead jobs as active drafting, and skips return silently (D9-F1/F2, D5-F1, G4-F1).

The Riley audit's meta-finding was _computed, then discarded_. Mira's sibling is _assembled, never energized_: the wiring is impressively complete in structure, the current has never flowed, and the system is silent about it. The highest-leverage work is not new capability. It is, in order: make the loop physically able to run and fail loudly (Tier 0), aim the publish leg at WhatsApp and close the booked join (Tiers 1 and 2), then let the agents feed each other (Tier 3) with compliance as the wedge-market product (Tier 4).

---

## 2. Current state of Mira (verified against `main` @ `84083f0c`)

| Layer                   | State on `main` today                                                                                                                                                                                                                         | Evidence                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Governance spine**    | **Sound.** All spend paths through ingress; publish park mandatory; PAUSED hardcoded at every Meta create site; approve ends in dispatch-or-recovery; seeds-to-gate behavior has the strongest pinning tests in the audit.                    | D4, G1                      |
| **Polished generation** | **Dead on arrival.** Nonexistent model id at every LLM stage; tier choice never reaches the render; zero-clip success; estimator overstates spend ~scriptCount times; pro assembly concatenates all variants into one video.                  | D1-F1..F5                   |
| **UGC generation**      | **Slice 3 shipped real** (frame QA, direction-faithful prompts, HeyGen routing, durable assets) but silent video by default (no voice synthesis on the Kling path), scene variety constant, provider-performance tracker unwired.             | D2-F3/F9/F11                |
| **Brain (briefs)**      | **Dark.** Both compose flags default off; compose policy seeded only for `org_dev`; drafts land as inert rows with no promote path; compose provenance never reaches the operator.                                                            | D3-F2/F3/F8                 |
| **Taste memory**        | **Half-loop.** Keep/Pass writes taste buckets and polished prompts read them; UGC taste is write-only; the Riley firewall holds.                                                                                                              | D3-F7, D2-F12               |
| **Revenue memory**      | **Unbuilt.** `revenue_proven` has zero writers repo-wide and zero ad-optimizer readers; Riley reallocates blind to creative provenance.                                                                                                       | D3-F1, G2-F7, D6-F3         |
| **Riley to Mira**       | **Live but information-poor.** Handoff parks, dedups, and creates a draft, but strips the diagnosis (generic BusinessFacts brief, `pastPerformance` null); enrichment fix exists behind a default-off flag.                                   | D6-F1/F8                    |
| **Alex to Mira**        | **Stub.** `funnelFrictions` hardcoded `[]`; the 8-rule friction translator and structure affinity scoring execute against nothing; `FunnelFriction` has no producer.                                                                          | D6-F4                       |
| **Mira to Riley**       | **Missing.** Handoff approval never transitions the source recommendation, so outcome attribution never measures handoffs; no creative outcomes reach any Riley surface.                                                                      | D6-F5, G2-F7                |
| **Publish leg**         | **Wrong shape, never proven.** Lead-form package with placeholder link; missing required Graph create params; SG-only targeting constants; pre-flight ignores `Connection.status` and WABA binding.                                           | G3, D4-F6, D8-F6            |
| **Booked attribution**  | **Spend leg sound, booked leg structurally dark for CTWA** (no `sourceCampaignId` producer); NaN-blind Meta numerics; currency-blind trueRoas; brief-createdAt window anchor.                                                                 | G2                          |
| **Human gate (inbox)**  | **Core round-trip correct and tested**; cards decision-blind (raw cuid, no preview, no expiry clock); structured error contract dead through the proxy; self-approval landmine for the planned publish button.                                | G1                          |
| **Desk**                | **Honest while everything is alive, dishonest after the first silent death**: zombies narrate as perpetual drafting; "I'll ping you" promises a notification that does not exist; `PENDING_APPROVAL` flattened to success by the brief proxy. | G4-F1/F4, D7-F1             |
| **Lifecycle substrate** | **No terminal failure marker for polished; no idempotency/concurrency guard on either runner** (replay corrupts terminal state); approval events match on jobId only; AgentTasks perpetually pending.                                         | D5-F1/F2, D1-F10, D5-F8     |
| **Provisioning**        | **Split-brain.** Enablement seed flips the UI; the deployment + 5 policies + threshold + house creator ride a seed only `org_dev` runs; the pilot runbook covers one quarter of the chain.                                                    | D8-F3, D4-F1, D9-F4         |
| **Observability**       | **Structurally dead by default.** Webhook-or-noop alerter, webhook set nowhere; publish failure alert:false with a zero-consumer dead-letter event; provider keys absent from prod topology.                                                  | D9-F1/F3/F5                 |
| **Evaluation**          | **None.** Four eval harnesses exist in `evals/`; none covers any Mira output; "winning creative" is unfalsifiable.                                                                                                                            | D9-F8                       |
| **Compliance posture**  | **Storage-only.** Likeness consent stored, enforced nowhere; claims gate is human-eyeball; SG bans the flagship testimonial format outright; no 18+ pin, no AI-disclosure state, no KKLIU slot.                                               | D2-F1/F10, D8-F2, R2, G3-F4 |
| **Channel invariant**   | **Holds by accident, not construction.** Two live routes can bind a channel to the creative deployment; the deny rests on policy default-deny plus seed-data accidents; the only test pins the opposite direction.                            | G5                          |

---

## 3. The meta-finding: _assembled, never energized, and silent about it_

Across all nine domains and five gap traces, the same shape recurs: **the wire exists, nothing flows through it, and no signal reports the absence.** This is the Mira variant of Riley's "computed, then discarded," and it means most of the highest-leverage work is energizing and instrumenting, not building.

| Built artifact                                                    | The dead wire                                                              | Consequence                                                 | Findings            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------- |
| Every LLM stage                                                   | Model id does not exist; no override path                                  | Pipeline cannot run live; all tests mock the SDK            | D1-F1               |
| Pro tier + assembly + durable assets                              | `productionTier` written after the memoized snapshot that reads it         | Polished publish always fails preconditions                 | D1-F2               |
| Kling bootstrap guard                                             | `run-stage` builds its own empty-key client                                | Guaranteed silent zero-output completion                    | D1-F4               |
| CTWA inbound capture chain                                        | `CtwaAdapter.resolveCampaignId` unwired; `getAdCampaignId` zero callers    | Booked revenue can never credit a Mira campaign             | G3-F3, G2-F1        |
| `revenue_proven` memory category + builder reads                  | Zero writers repo-wide                                                     | The brain's measured-winner channel can never fire          | D3-F1, G2-F7        |
| 8-rule funnel-friction translator + affinity scoring              | `funnelFrictions: []` hardcoded                                            | Alex conversation reality never shapes creative             | D6-F4               |
| Handoff brief enrichment (compose-before-park, fallback-safe)     | Flag defaults off                                                          | Every handoff lands a byte-identical boilerplate draft      | D6-F8/F1            |
| Self-brief cron + brain                                           | Flag off + policy/deployment seeded only for `org_dev` + entitlement floor | No production org has ever exercised the brain              | D3-F2               |
| Concept drafts (self-brief, handoff)                              | No promote intent; no surface advances a draft                             | Operators must re-type proposals; WorkTrace lineage severed | D6-F2, D3-F3, D5-F7 |
| `ProviderPerformanceTracker`                                      | Constructed only in tests                                                  | Routing cannot learn provider quality                       | D2-F11              |
| Creator `elevenLabsVoiceId` + voice synthesis                     | No UGC path synthesizes speech                                             | Default UGC output is a silent talking-head ad              | D2-F3               |
| `claimsPolicyTag`                                                 | Never populated, never read                                                | Claims safety is human-eyeball only                         | D2-F10              |
| `ugcConfig.retryConfig`                                           | Runner hardcodes its own values                                            | Operator config silently no-ops                             | D2-F8               |
| Operator alerter                                                  | Webhook-or-noop; webhook set nowhere in prod topology                      | Every alert path is a silent no-op                          | D9-F1               |
| `creative.publish.failed` dead-letter event                       | Zero consumers; `alert:false`                                              | Approved publish that fails on Meta is invisible            | D9-F3               |
| Mira activity + wins surfaces                                     | No producer can attribute entries to Mira                                  | Structurally empty forever                                  | G4-F2/F6            |
| `registerPipelineIntents`                                         | No caller                                                                  | Governed-looking intents never registered                   | D4-F8               |
| `classifyBriefIntent`                                             | Client-side only                                                           | API accepts off-scope briefs into a paid pipeline           | D3-F6               |
| KPI adapter, footer/empty copy, `mira-config` "no composer" claim | Zero consumers or stale                                                    | Operator-surface modules contradict the shipped desk        | D7-F8               |

> If you internalize one thing: **Mira's remaining cost is mostly wiring and instrumentation that is already paid for in structure. But unlike Riley, several wires are not merely unplugged, they are miswired (model id, tier snapshot, package shape), and the system's silence hides that difference.**

---

## 4. Cross-cutting themes

- **A. The loop has never run, and cannot prove it.** No polished job can have completed against live providers (D1-F1 predicts it; an open question asks for run logs); publish was never proven against real Graph (mock-only tests, missing required params, G3-F2); attribution is flag-off. There is no end-to-end smoke proof anywhere.
- **B. Silent failure is the default.** Zero-clip success (D1-F4), zombie jobs with no terminal marker (D5-F1, D9-F2), alert-into-noop (D9-F1), publish failure invisible (D9-F3), skips unaggregated (D9-F7), expired approvals vanishing without trace (G1-F3, D6-F7). The desk then narrates the corpse as alive (G4-F1).
- **C. Enablement is split four ways.** UI enablement (seed), governance install (different seed, dev-only), billing entitlement, and env flags must all align; today no single command aligns them and the runbook covers one of four (D8-F3, D4-F1, D9-F4, D3-F2).
- **D. Information valves are one-way or closed.** Riley's diagnosis is stripped at handoff (D6-F1); Mira's outcomes never reach Riley (D6-F3/F5, G2-F7); Alex's funnel is a stub (D6-F4); UGC taste is write-only (D3-F7).
- **E. The money numbers cannot yet be trusted.** Estimator overstates ~N times (D1-F3); budget tracker undercounts long clips (D2-F13); Float dollars and cents-by-convention (D8-F7); currency-blind trueRoas (G2-F4); unmetered Claude tokens, per-job caps only (D9-F6).
- **F. Tenancy and consent debt sits exactly on the likeness kill-switch.** Consent stored but enforced nowhere (D2-F1, D8-F2); `revoke()` tenant-unscoped (D8-F1); public permanent assets with no deletion lifecycle (D8-F8); `CreatorIdentity`/`AssetRecord` lack org columns (D8-F4).
- **G. Compliance is the wedge-market product, not a checkbox.** SG HCSA bans testimonials and before/after imagery outright; MY requires KKLIU pre-approval for treatment claims; Meta restricts cosmetic-procedure targeting to 18+ and auto-detects synthetic media. Mira's flagship patient-voice UGC format is structurally non-compliant in the wedge market; provider-led and educational formats are the compliant alternative (R2, R1-I2, G3-F4).
- **H. Nothing measures creative quality.** No Mira eval harness (D9-F8); taste is one operator's Keep/Pass at structure granularity (D2-F12); the competitive bar is 8 to 15 concepts per campaign with performance feedback loops (R1-I3).

---

## 5. Prioritized backlog

Ranked by (impact on the north star × confidence) ÷ effort within tiers; tiers form the recommended sequence. Effort: S ≤ ~1 day, M ≈ a few days, L ≈ a week+. Tags: `[planned]` in a spec/roadmap, `[extends]` sharpens planned work, `[new]` net-new.

### Tier 0: make the loop able to run, and make death loud (do first; mostly S)

| #   | Recommendation                                                                                                                                                                                                                      | Effort | Tag                                 | Key locations                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0.1 | **Fix the model id and make it configurable** (env or LLMConfig override; reject unknown ids at boot)                                                                                                                               | S      | `[new]` D1-F1                       | `stages/call-claude.ts:5,77,102`                                                                                   |
| 0.2 | **Fix tier propagation**: re-read the job inside the production step (or carry stage+tier on `stage.approved`) so the operator's choice reaches the render                                                                          | S      | `[new]` D1-F2                       | `creative-job-runner.ts:63,123`; `creative-job-decision-workflow.ts:47-53`                                         |
| 0.3 | **Zero output = failure**: throw when clips are empty, delete `run-stage`'s empty-key Kling client in favor of the bootstrap-guarded one, so retries + onFailure dead-letter actually engage                                        | M      | `[extends]` D1-F4                   | `stages/video-producer.ts:132-149`; `stages/run-stage.ts:144`                                                      |
| 0.4 | **Terminal failure marker + replay guard on both runners**: polished `fail` persistence (mirror `failUgc`), Inngest idempotency/concurrency config, stage-scoped approval matching                                                  | M      | `[extends]` D5-F1/F2, D1-F10, D9-F2 | `creative-job-runner.ts`; `ugc-job-runner.ts`                                                                      |
| 0.5 | **Turn alerting on**: set `OPERATOR_ALERT_WEBHOOK_URL` in prod topology, flip publish `alert:true`, consume `creative.publish.failed`, surface `metaPublishStatus`                                                                  | S      | `[new]` D9-F1/F3                    | `app.ts:447-454`; `creative-publish-function.ts:53-60`; `render.yaml`                                              |
| 0.6 | **Provider keys into prod topology + estimator double-count fix**                                                                                                                                                                   | S      | `[new]` D9-F5, D1-F3                | `render.yaml`; `provisioning.md`; `stages/cost-estimator.ts:87-101`                                                |
| 0.7 | **One-command pilot provisioning**: deployment + 5 policies + threshold + house creator + enablement + entitlement + flags, runbook updated (closes the split-brain)                                                                | M      | `[planned]` D8-F3, D4-F1, D9-F4     | `seed-mira-pilot-orgs.ts`; `seed-mira-creative-deployment.ts`; `docs/runbooks/2026-05-29-mira-pilot-enablement.md` |
| 0.8 | **Pin the channel deny**: conversational-surface allowlist at the registrar or binding routes, plus the two pinning tests G5 specifies (today the deny is a seed-data accident one unanchored `creative.*` allow row from flipping) | S      | `[new]` G5-F1/F2/F4                 | `skill-intent-registrar.ts:41`; `marketplace.ts:519-656`                                                           |

### Tier 1: aim the publish leg at the wedge (CTWA)

| #   | Recommendation                                                                                                                                                                                                       | Effort | Tag                      | Key locations                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| 1.1 | **CTWA-shape the package** via one pure builder: `OUTCOME_ENGAGEMENT`, `destination_type: WHATSAPP`, `promoted_object`, `WHATSAPP_MESSAGE` CTA, currency-aware budget, org-country targeting, explicit `age_min: 18` | M      | `[new]` G3-F1/F7, D4-F6  | `creative-publish-function.ts:15-21`; `meta-ads-client.ts`                                 |
| 1.2 | **Add Meta-required create params** (`special_ad_categories`, `billing_event`, `promoted_object`) and prove the chain once against a sandbox ad account                                                              | S      | `[extends]` G3-F2        | `meta-ads-client.ts` create chain                                                          |
| 1.3 | **Wire `resolveCampaignId` at CTWA intake** (and call `getAdCampaignId`) so booked conversions can credit Mira campaigns: the single missing inbound link                                                            | M      | `[extends]` G3-F3, G2-F1 | `apps/chat/src/main.ts:168-181`                                                            |
| 1.4 | **Pre-flight truthfulness**: require `Connection.status === "connected"` and verified page-to-WABA binding (wabaId/phoneNumberId already stored)                                                                     | S      | `[extends]` D8-F6, G3-F6 | `creative-publish-preconditions.ts:65`                                                     |
| 1.5 | **Make the human gate decision-capable**: enrich publish card (title, video link, ad account), fix the structured error contract through the proxy, show the 24h expiry clock on workflow_approval cards             | M      | `[extends]` G1-F1/F2/F3  | `parked-approval-cards.ts:68-87`; `approvals/route.ts:28-33`; `inbox-decision-card.tsx:76` |

### Tier 2: make the measured legs trustworthy

| #   | Recommendation                                                                                                                                                                                                                 | Effort | Tag                             | Key locations                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------- | -------------------------------------- |
| 2.1 | **Harden attribution numerics**: `Number.isFinite` guards + runtime schema parse on Meta insights, write-side parse before `setPastPerformance`, currency stamp on the row                                                     | S      | `[new]` G2-F2/F3/F4             | `creative-attribution.ts`              |
| 2.2 | **Anchor the window on publish, follow paging** (today: org-shared brief-createdAt anchor; page-1-only reads freeze orgs past 25 campaigns)                                                                                    | S      | `[new]` G2-F5/F6                | `creative-attribution.ts`              |
| 2.3 | **Count completions by completion**: stop `updatedAt`-proxying `shippedThisWeek` (Keep/Pass inflates it today, no flag needed)                                                                                                 | S      | `[extends]` D5-F6, G4-F3        | `build-read-model.ts:53-69`            |
| 2.4 | **Per-variant deliverables**: one assembled video per script (today all variants concatenate into one video with one voiceover reading every script), the precondition for per-creative attribution and regenerate-the-winners | M      | `[new]` D1-F5                   | `stages/video-producer.ts:156,206-231` |
| 2.5 | **Build the `revenue_proven` writer (Riley-owned promotion) and a Riley reader**, closing "Riley sees what creative earns"                                                                                                     | M      | `[planned]` G2-F7, D6-F3, D3-F1 | slice-2 spec; `packages/ad-optimizer`  |

### Tier 3: synergy: information-rich handoffs, reachable UGC

| #   | Recommendation                                                                                                                                                                           | Effort | Tag                             | Key locations                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- | ------------------------------------------------------------------ |
| 3.1 | **Flip `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED`** (verified compose-before-park with byte-identical fallback; the cheapest live synergy upgrade)                                          | S      | `[planned]` D6-F8               | `.env` topology                                                    |
| 3.2 | **Carry Riley's diagnosis into the draft**: campaignId, actionType, rationale, evidence onto CreativeJob/brief (today stripped at the point of value transfer)                           | S      | `[extends]` D6-F1               | `recommendation-handoff-workflow.ts`                               |
| 3.3 | **Promote intent: draft to generation** without re-typing (preserve WorkTrace lineage and Riley provenance)                                                                              | M      | `[extends]` D6-F2, D3-F3, D5-F7 | new intent + `creative-concept-draft-workflow.ts`                  |
| 3.4 | **Coordinate handoff state**: approval transitions the source recommendation (outcome attribution measures it); per-intent park expiry instead of the global 24h vs weekly cron mismatch | S      | `[extends]` D6-F5/F7            | `recommendation-handoff-workflow.ts`; `platform-ingress.ts:303`    |
| 3.5 | **Mode parameter for agent-initiated UGC** (handoff and self-brief are hardwired polished)                                                                                               | M      | `[planned]` D2-F4               | `creative-concept-draft-workflow.ts`; `mira-self-brief-request.ts` |
| 3.6 | **Alex friction producer** (SP8): populate `FunnelFriction` from Alex conversations; the translator and affinity scoring are already built and tested                                    | L      | `[planned]` D6-F4               | new producer; `ugc-job-runner.ts`                                  |
| 3.7 | **Flip self-brief** after 0.7 + the zombie/backlog fix (dead jobs permanently consume the inFlight cap of 5 today)                                                                       | S      | `[planned]` D3-F2, D9-F2        | `.env` topology                                                    |

### Tier 4: compliance as the wedge-market product

| #   | Recommendation                                                                                                                                                             | Effort | Tag                         | Key locations                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------- | -------------------------------------------------- |
| 4.1 | **Jurisdiction-aware publish gate**: SG blocks (testimonial-form, before/after, superlatives), MY KKLIU approval slot, 18+ pin, prescription-brand lexicon warn-then-block | M      | `[new]` R2, G3-F4           | publish gate; `creative-publish-preconditions.ts`  |
| 4.2 | **Claims library + script classifier** (roadmap invariant 4 is currently unimplemented: `claimsPolicyTag` dead, banned-phrases scanner covers chat only)                   | M      | `[planned]` D2-F10          | `ugc-script-writer.ts`; new claim library          |
| 4.3 | **Enforce likeness consent at cast/render/publish + revocation propagation** (today storage-only; assets public and permanent with no deletion lifecycle)                  | M      | `[extends]` D2-F1, D8-F2/F8 | `scene-caster.ts`; `creative-asset-storage.ts`     |
| 4.4 | **Tenant-scope the consent store + org columns for CreatorIdentity/AssetRecord** (migration)                                                                               | S      | `[planned]` D8-F1/F4, D2-F2 | `prisma-consent-record-store.ts`; schema migration |
| 4.5 | **AI-disclosure state on WorkTrace + keep-provenance posture** (C2PA/IPTC intact through the render pipeline)                                                              | S      | `[new]` R2-I4, G3-F4        | publish chain                                      |
| 4.6 | **Govern the ad copy**: primary text review (raw `productDescription` ships as ad copy today) and the CTWA welcome message as governed copy                                | S      | `[new]` G3-F5               | `creative-publish-function.ts`                     |

### Tier 5: brain and taste maturity

| #   | Recommendation                                                                                                                                                                                                         | Effort | Tag                              | Key locations                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------- | ----------------------------------- |
| 5.1 | **Mira eval harness** in `evals/` (brief-compose deterministic scenarios first; the governance-decision template and CI gate already exist)                                                                            | M      | `[new]` D9-F8                    | `evals/`                            |
| 5.2 | **UGC taste feedback into generation + variant fanout** (8 to 15 concepts per campaign is the Andromeda-era bar; permutate hook × persona × CTA on an approved concept so governance cost per variant stays near zero) | M      | `[extends]` D3-F7, D2-F12, R1-I3 | `ugc-job-runner.ts`; taste provider |
| 5.3 | **Vertical hook library** seeded from Ad Library mining + own outcomes (one operator's Keep/Pass cannot cold-start against competitors' ad corpora)                                                                    | M      | `[new]` R1-I4                    | new                                 |
| 5.4 | **Compose provenance to the operator**: surface abstain reasons and proposal rationale (today only in Inngest history and WorkTrace)                                                                                   | S      | `[extends]` D3-F8                | `mira-self-brief.ts`; desk          |
| 5.5 | **Desk death-honesty**: staleness narrative for zombies (same PR as 0.4), fix or remove the false "I'll ping you" promise, ready-count vs feed `hasVideo` divergence, kept-shelf window                                | S      | `[extends]` G4-F1/F4, D7-F5/F6   | `desk-model.ts`; `greeting.ts`      |

### Tier 6: hardening and hygiene (sprinkle alongside)

| #   | Recommendation                                                                                                                                                                                                                                                  | Effort | Tag                                                         | Key locations                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- | ---------------------------------------------- |
| 6.1 | Cross-check client-supplied `deploymentId` against the ingress-resolved context (taste topology rides on it)                                                                                                                                                    | S      | `[new]` D4-F3, D3-F4                                        | `creative-job-submit-workflow.ts:6-11`         |
| 6.2 | Idempotency keys on operator creative submits (claim-first guard never engages today)                                                                                                                                                                           | S      | `[extends]` D4-F4                                           | `routes/creative-pipeline.ts`; `mira-brief.ts` |
| 6.3 | Pinning test: no financial intent registers `system_auto_approved` (the #931/Riley-7.1 sibling; today comment-enforced)                                                                                                                                         | S      | `[extends]` D4-F5                                           | `governance-gate.ts:100-108`                   |
| 6.4 | Per-org/period generation spend ceiling + Claude token metering (per-job caps only today)                                                                                                                                                                       | M      | `[new]` D9-F6                                               | `creative-job-submit-workflow.ts`              |
| 6.5 | Telemetry on named skips and zero-output dispatches (weekly cadence makes misconfig cost weeks)                                                                                                                                                                 | S      | `[new]` D9-F7                                               | creative crons                                 |
| 6.6 | `PENDING_APPROVAL` envelope through the brief proxy (latent phantom-success; sibling proxy already does it right)                                                                                                                                               | S      | `[extends]` D7-F1                                           | `agents/mira/brief/route.ts`                   |
| 6.7 | Debt sweep: split `bootstrap/inngest.ts` (1280 lines), env-allowlist `packages/` scan gap, dead modules (`registerPipelineIntents`, KPI adapter, stale `mira-config` copy, dead RQ hooks), DALL-E URL expiry, silent 24h gate timeouts, demo-fixture taste leak | M      | `[extends]` D9-F9/F11, D7-F8, D4-F8, D5-F9, D1-F8/F9, D8-F5 | various                                        |

---

## 6. Recommended sequence

```
NOW ── Tier 0 (loop runs + death is loud + one-command provisioning + pin the channel deny)
  │        0.1+0.2+0.3 make a real creative possible; 0.4+0.5 make failure visible;
  │        0.7 makes a real org possible; 0.8 is the cheap safety pin
  │
  └──► Tier 1 (CTWA package + booked join + decision-capable inbox)
           │     after 1.1-1.3 a Mira ad can START an Alex conversation and a paid
           │     visit can CREDIT a Mira campaign: the first receipted booking per creative
           │
           └──► Tier 2 (trustworthy numbers; per-variant deliverables; revenue_proven)
                    │
                    ├──► Tier 3 (synergy flips: enrichment, diagnosis-rich handoffs,
                    │            promote intent, agent-initiated UGC, Alex frictions)
                    │
                    ├──► Tier 4 (compliance gate: the SG/MY wedge product)  ← parallel with Tier 3
                    │
                    └──► Tier 5 (eval harness, taste maturity, variant volume)

Tier 6 hygiene items ride along inside whichever PR touches their file.
```

**If you want one next increment:** 0.1 + 0.2 + 0.3 + 0.5 (one honest creative exists, or fails loudly), then 0.7 (a real org can run it), then 1.1 + 1.2 + 1.3 (the ad starts a WhatsApp conversation and the booking credits the campaign). That is the shortest path to the product's headline number existing at all.

---

## 7. Reconciliation with the 2026-06-03 roadmap

The roadmap (`docs/superpowers/specs/2026-06-03-mira-roadmap.md`) sequenced slices 1-4 loop-first and recorded all four shipped by 2026-06-05 (#911-#916). The audit confirms the **structure** shipped and corrects the **status**:

- **Slice 1 (publish pilot-safe): shipped with an asterisk.** The dead-lettered Inngest publish function with per-object checkpoints is real and verified (D4/D5). But its failures are alert-silent with a zero-consumer dead-letter event (D9-F3), the package shape cannot serve the CTWA wedge (G3-F1), required Graph params are missing so it has never been provable against real Meta (G3-F2), and polished assets can never reach it (D1-F2).
- **Slice 2 (learning loop): half-shipped.** The attribution worker is sound on the spend leg (idempotent, no-downgrade, cents-once: G2 verdict) but flag-off, the booked leg has no producer for CTWA (G2-F1), and the spec's own crux, the taste/revenue-proven split with Riley-owned promotion, is exactly the half that does not exist (D3-F1, G2-F7).
- **Slice 3 (generator quality): genuinely shipped for UGC** (real frame QA, direction-faithful prompts, desk reachability, HeyGen routing: D2 verdict), **dead for polished** (model id, tier snapshot: D1-F1/F2), and **unreachable by agents** (handoff and self-brief hardwire polished: D2-F4).
- **Slice 4 (brain): built, dark, and inert.** SKILL.md, builder, executor, and governance tests are real (D3/D4), but flags default off, the install is org_dev-only, and accepted proposals dead-end as drafts no surface can advance (D3-F2/F3, D6-F2).
- **Roadmap invariant 5 ("nothing ships built-but-unwired") was violated in spirit by all four slices.** The §3 table is the inventory. The invariant needs an enforcement mechanism, not restatement: the eval/smoke gate in 5.1 plus the Tier-0 alerting work is that mechanism.
- **Memory/pointer corrections:** "Mira loop ROADMAP COMPLETE 2026-06-05" should read "structurally complete, never energized"; "2 of 3 go-live blockers cleared" is wrong for polished (durable assets are set only by the pro assembly path that F2 makes unreachable); the PR #957 provisioning runbook is infra-scoped and does not provision a Mira org (D9-F4 open question).

---

## 8. Verification log

- **Process:** every domain report was adversarially re-verified by an independent agent instructed to refute (open every cited line, hunt counter-evidence, recalibrate severity). D1 and D2 effectively received two passes (the first run was killed by a usage cap after the auditors wrote their reports; the resumed run re-verified from scratch). Zero of 120 findings were refuted; corrections were narrow (D2-F5 feed-gate symbol, D2-F13 tracked-overshoot arithmetic, D3-F3 label copy, D5-F2 re-run mediation mechanism, D5-F8 manual-route existence, D9-F7 log-level precision, G3's correction that the inbound CTWA chain is nearly real rather than absent).
- **Critic:** all nine producer-to-consumer seams were traced on both sides; nine of ten doctrine invariants affirmatively checked by domains; the tenth (channel-as-ingress) was settled by G5: intact today by policy default-deny plus seed accident, not by construction, and pinned by nothing.
- **Convergent duplicates** (independent domains, same defect) were deduplicated in §5: D3-F4/D4-F3 (deploymentId trust), D5-F1/D9-F2 (zombies), D2-F1/D8-F2 (consent), D3-F3/D5-F7/D6-F2 (inert drafts), D2-F2/D8-F1 (consent store scoping), D5-F6/G4-F3 (updatedAt inflation).
- **Stands unverified:** research claims are web-sourced (cited with URLs and dates in R1/R2, uncertainty marked inline); deployed Inngest duplicate-delivery characteristics (D5-F2 likelihood rides on it); whether any polished job ever completed in any environment (run logs would settle it); Kling's live auth scheme vs the static-Bearer client (D1 open question).
- **Spend:** ~6.5M subagent tokens, 31 agents (9 auditors, 9 verifier-correctors, 2 researchers, 1 critic, 5 gap closers, plus the first run's casualties), two usage-cap interruptions survived via journal resume.

---

## 9. Open decisions for you

1. **Publish surface doctrine (D4-F2, G1-F4).** The M1 draft-only doctrine is actively pinned by guard tests; the act leg is curl-only. Land a real publish surface (amending the copy-hygiene guard, deciding the self-approval posture: per-org second approver vs scoped `ALLOW_SELF_APPROVAL`), or keep draft-only through the pilot?
2. **UGC format strategy for the wedge (R2-I1, G3-F4).** Patient-voice testimonial UGC is HCSA-banned in SG. Pivot the default format to provider-led/educational (compliant, and R1 notes provider-led also converts) and keep patient-voice for non-restricted geos, or keep building patient-voice first?
3. **CTWA optimization target (R2-I6, G2).** Meta's 2025 health data restrictions likely block lower-funnel optimization for medspa destinations: optimize Conversations Started and let receipted bookings be the internal truth, or fight for booked-event optimization?
4. **Flag-flip cadence (D6-F8, D3-F2).** Enrichment is verified safe to flip now; self-brief should wait for 0.4/0.7. Flip enrichment immediately for org_dev and first pilot?
5. **The `mira-decision` ingress exception (D4-F9).** Keep/Pass is a sanctioned, allowlisted direct write (draft-only, org-scoped) but it is also the publish precondition and taste input, and entitlement-asymmetric. Formalize the exception in doctrine, or migrate it through ingress with an entitlement check?
6. **Eval scope (5.1).** Start with deterministic brief-compose scenarios (cheap, CI-gated day one) or invest directly in a model-graded creative-quality rubric?
7. **Where does org-level Mira provisioning live (D9-F4)?** PR #957's `provisioning.md` is host-scoped. Same file or a sibling org-provisioning runbook owned with 0.7?

---

_Full per-domain evidence with file:line citations:_ [`D1 polished pipeline`](./domains/D1-polished-pipeline.md) · [`D2 UGC engine`](./domains/D2-ugc-engine.md) · [`D3 brain/taste/learning`](./domains/D3-brain-briefs-taste-learning.md) · [`D4 governance/ingress/publish`](./domains/D4-governance-ingress-publish.md) · [`D5 lifecycle/async`](./domains/D5-lifecycle-async-substrate.md) · [`D6 cross-agent synergy`](./domains/D6-cross-agent-synergy.md) · [`D7 operator surface`](./domains/D7-operator-surface.md) · [`D8 data/tenancy`](./domains/D8-data-layer-tenancy.md) · [`D9 ops/eval/scale`](./domains/D9-ops-readiness-eval.md) · [`G1 inbox approval loop`](./domains/G1-inbox-approval-loop.md) · [`G2 attribution math`](./domains/G2-attribution-math.md) · [`G3 publish package/CTWA`](./domains/G3-publish-package-ctwa.md) · [`G4 agent-home honesty`](./domains/G4-agent-home-honesty.md) · [`G5 channel invariant`](./domains/G5-channel-ingress-invariant.md) · _research:_ [`R1 market landscape`](./research/R1-market-landscape.md) · [`R2 platform/policy`](./research/R2-platform-policy.md)
