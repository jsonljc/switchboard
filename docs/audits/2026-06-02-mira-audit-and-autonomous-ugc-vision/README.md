# Mira: Current-State Audit + Autonomous Power-UGC Vision

**Date:** 2026-06-02
**Author:** Claude (9-lane subagent fan-out — 4 codebase audit lanes, 5 frontier-research lanes)
**Goal that prompted this:** _"Mira should autonomously create powerful UGC creatives for advertisers, for stronger ad performance and ROI."_

> Detail docs:
>
> - [`01-mira-current-state-audit.md`](./01-mira-current-state-audit.md) — the full codebase audit (agent definition, generation pipeline, surfaces/lifecycle, creative→ad→ROI loop), with file:line evidence.
> - [`02-frontier-research.md`](./02-frontier-research.md) — Higgsfield deep-dive, UGC-tool landscape, generative-media building blocks + costs, the UGC performance playbook, and autonomous-creative-agent architecture, with sources.

---

## TL;DR

Mira today is **a draft-triage cockpit bolted onto a real-but-thin, single-provider, partly-stubbed video pipeline — not an agent and not autonomous.** She has no brain (no persona, no system prompt, no skill, no tools, no memory), produces no true avatar/spokesperson UGC (the only avatar provider, HeyGen, is a `throw` stub; UGC clips are generic Kling text-to-video), her quality QA is **fake** (it never sends video frames to the model), and the loop that would make the ROI claim real is **open at both ends** — nothing publishes a Mira creative to a live ad, and no ad performance ever flows back into the next creative.

The frontier (Higgsfield, Creatify, Arcads, HeyGen, Mirage, et al.) has solved _generation_ — finished talking-head UGC now costs **~$0.65–$2.15 per 30s clip** at volume. But **nobody has closed the loop**: not one product generates → publishes to the ad account → reads live ROAS → regenerates the winners, under governance.

**That open loop is exactly what Switchboard is architecturally built to own.** The governance gate, ingress, WorkTrace, deployment memory, Riley's Meta-performance reads, a per-creative analyzer, and the Alex→Mira handoff already exist. The missing pieces to make Mira an _autonomous performance-creative agent_ are mostly **wiring, not invention** — the same "built-but-unwired" pattern this codebase keeps hitting.

---

## The strategic thesis

The UGC-ad-tooling market has commoditized **creative generation** and left the **performance loop** wide open:

| What the market does well                                                                                                | What no one does                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Generate realistic avatar/UGC video from a script or product URL (Higgsfield Marketing Studio, Creatify, HeyGen, Arcads) | Push the generated creative into the ad account as a governed action           |
| Produce dozens of variants per product in minutes                                                                        | Read **per-creative** live ROAS/CTR back out                                   |
| Cinematic motion presets, character persistence, localization                                                            | Feed "what won and why" into the **next** brief automatically                  |
| Pre-spend "creative scores" (Pencil, AdCreative.ai)                                                                      | Do any of this **under brand-safety / spend governance** with human escalation |

Higgsfield's own "Supercomputer" agent still pauses for human approval at every milestone, has **no closed performance→creative loop**, and ships on an immature API — and it just had a content-moderation scandal for having _no_ governance. Switchboard's entire reason for existing ("a governed operating system for revenue actions") is the missing half of the market. **Mira's product is the loop, not the generator.** The generator is a commodity we should compose, not build.

---

## Mira as-is: the audit verdict

Mira exists at **three disconnected layers that do not share a brain**:

1. **Identity** — a static registry entry (`packages/schemas/src/agents.ts`): `key:"mira"`, `role:"creative"`, violet hue, `launchTier:"day-thirty"`, opt-in per org. There is **no agent manifest, no skill builder, no persona, no system prompt, no tools, no conversational runtime.** Mira never speaks or reasons. "Mira" is a label on a `CreativeJob` pipeline.
2. **Cockpit** — `/mira` Director's Desk (brief box + ready-to-review hero + in-production tray + Keep shelf) and a `/mira/review` TikTok-style feed. This is a **real projection** over persisted `CreativeJob` rows (`MiraCreativeReadModel`), not a fixture seam. Gestures: **Continue** (keep producing, cost-gated), **Stop** (abort), **Keep/Pass** (a reversible review verdict that writes one DB field, firewalled from Riley).
3. **Pipeline** — `packages/creative-pipeline`, two pipelines behind a mode-dispatcher: "polished" (default) and "ugc".

**What's genuinely real:** Claude (Sonnet-4.5) generates trends → hooks → scripts → storyboards (the copy layer is strong, including UGC-authentic script prompts — filler words, no ad-speak). Production renders real video via **Kling**, plus pro-tier ElevenLabs voiceover + Whisper captions + FFmpeg assembly + DALL·E 3 reference images. With API keys set, the pipeline does run in `apps/api` and produces a real captioned MP4 draft.

**What's stubbed, fake, or absent (the load-bearing gaps):**

| Capability                            | Status                                                | Evidence                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avatar / talking-head video (HeyGen)  | **STUB — throws**                                     | `heygen-client.ts:25`, `ugc/video-provider.ts:70`; Seedance & Runway also throw                                                                                                                 |
| UGC video uses the computed direction | **ABSENT** — raw script text is the prompt            | `ugc/phases/production.ts:115` passes `spec.script.text`; `SceneStyle`/`UgcDirection` never reach the model                                                                                     |
| "Claude Vision" realism QA            | **FAKE** — URL-as-text, no frames sent                | `realism-scorer.ts:162` + `call-claude.ts:46` (plain string). Scores are hallucinated; they gate `approvalState`                                                                                |
| Durable asset storage (R2/S3)         | **ABSENT** — temp files                               | `elevenlabs-client.ts:53`, `video-producer.ts:161` "upload to R2" TODOs                                                                                                                         |
| UGC path reachable from Mira          | **NO** — both entry points hardcode `mode:"polished"` | `mira-brief.ts:133`, delegate path                                                                                                                                                              |
| Autonomy / self-initiation            | **ZERO**                                              | Mira only acts on a human one-line brief; Alex→Mira delegation is **draft-only, fires no pipeline** (`creative-concept-draft-workflow.ts:140` "NO inngestClient.send")                          |
| Performance → next creative           | **ABSENT**                                            | `CreativeJob.pastPerformance` is `null` at every producer; learning loop only learns Alex's _conversation_ booking patterns                                                                     |
| **Publish creative → live ad**        | **ABSENT**                                            | `MetaAdsClient.uploadCreativeAsset`/`createDraftAdSet` exist but have **zero non-test callers**; `updateCampaignStatus("ACTIVE")` is hard-`throw`-blocked; no `metaAdId` field on `CreativeJob` |
| Per-creative attribution              | **ABSENT for Mira**                                   | `creative-analyzer.ts` ranks by Meta `video_id` — but only for ads already on the platform; nothing links a Mira asset to an ad                                                                 |
| `spendApprovalThreshold` enforcement  | **STORED ≠ ENFORCED**                                 | resolved in `prisma-deployment-resolver.ts:28`, never read by `GovernanceGate` (confirms `[[feedback_autonomy_fields_stored_not_enforced]]`)                                                    |

**Verdict:** Mira is a human-in-the-loop creative **drafting + triage** tool, deliberately firewalled from publishing and learning (Phase-2/M1 scope). "Mira creative X drove $Y at Z ROAS" is **fully aspirational** today — every link in that sentence is missing.

---

## The gap: today → "autonomous power UGC creatives"

Six named gaps, in dependency order:

1. **No brain.** There is no Mira agent — no persona, planning, tools, or memory. Generation is a fixed pipeline triggered by a human one-liner.
2. **No real UGC.** No avatar/spokesperson video; the rich scene/identity direction is computed and discarded; QA can't actually see the video.
3. **No publish path.** The creative never becomes a live (even paused) ad. This is the **#1 ROI blocker** — without it, none of the rest matters.
4. **No measurement link.** Even with publishing, nothing ties a specific Mira creative to its conversions/ROAS.
5. **No learning loop.** `pastPerformance` is null; no winning-pattern memory; no Riley→Mira propagation.
6. **No governed autonomy.** Spend gates are stored-not-enforced; Continue/Stop currently **bypass** `PlatformIngress` (direct Inngest), so autonomous spend would have no GovernanceGate; no graduated-trust model on the Mira surface.

---

## End-state vision: Mira as an autonomous governed performance-creative agent

Mira becomes an agent that, given a product/offer (ideally **just a URL** — Higgsfield's best UX primitive) and a goal:

1. **Plans** a creative strategy — mines winning hooks/formats for the vertical, drafts concepts grounded in a brand profile + a **pre-approved claim library** (mandatory for medspa/health).
2. **Generates at volume, cheaply, tiered** — many distinct hook×format×creator variants (the playbook demands 15–30+/week, 6+ genuinely-distinct for DCO). Cheap text drafts → mid-fidelity stills → full video only for finalists. Composes best-of-breed providers (a `fal.ai`-style routing backbone + HeyGen/Hedra avatars + ElevenLabs voice + Veo 3.1 for native synced dialogue) instead of Kling-only.
3. **Self-QAs for real** — multimodal frame checks, an authenticity score, and a compliance/claim-library gate before anything spends.
4. **Publishes under governance** — pushes finalists as **PAUSED** draft ads through `PlatformIngress` (governed, traced), records the `metaAdId`. Activation stays human-gated until trust is earned, then governed-auto within an **enforced** spend cap.
5. **Measures per-creative** — joins live ROAS/CTR/thumb-stop back to the specific Mira asset.
6. **Learns and propagates** — extracts winning elements into a performance-tagged creative memory, enriches the next brief ("transformation hooks beat question hooks for injectables, 25–44F"), and consumes Riley's signals. The loop closes; the next campaign is smarter than the last.

This is **not "another UGC generator."** It is the one place the creative is generated, shipped, measured, and improved as a single governed, audited, escalation-aware loop — which is precisely the whitespace the whole market leaves open.

---

## Reference architecture (condensed)

Orchestrator-worker creative team, each worker a governed tool/sub-agent; long renders as Inngest steps; QA and human gates load-bearing:

```
Strategist → Scriptwriter → Director → Production → QA → Media-buyer → Learning
   (brief      (hook×format    (visual    (avatar +    (frames+    (publish PAUSED   (tag winners →
   enrich +     variants,       prompts,   voice +      authenticity  via ingress,      perf-tagged
   claim lib)   cheap drafts)   stills)    assembly)    + claim gate) record metaAdId)  memory → next brief)
        ▲                                                                                      │
        └───────────────────── closed loop: per-creative ROAS → winning-element memory ────────┘
```

Graduated autonomy (per deployment trust tier): copy/video generation and memory writes are auto at every tier; **pre-spend compliance review of health claims is human-gated at every tier (hard invariant)**; test-budget allocation and winner-scaling unlock as trust rises. LLM-as-judge is an unreliable creative judge (research: ρ<0.35 vs humans) — winner selection uses human pairwise + engagement proxies (hook rate, hold rate), not model self-scoring.

---

## Phased roadmap

Each phase ships value independently and de-risks the next. Phases 0–1 improve drafts; **Phase 2 is where the ROI claim first becomes possible**; Phase 3 closes the loop; Phase 4 delivers autonomy.

### Phase 0 — Make the pipeline tell the truth (de-stub correctness)

Build on the existing pipeline; no new agent.

- **Real multimodal QA** — send keyframes as image content blocks to the VLM (today `realism-scorer` sends a URL string). Until this lands, the quality gate is fiction.
- **Feed the computed direction into the video prompt** — `SceneStyle`/`UgcDirection` + a reference image, not raw `spec.script.text`.
- **Durable asset storage** (R2) — replace temp-file outputs.
- **Make UGC mode reachable** from Mira's brief/delegate entry points (drop the hardcoded `polished`).
- _Unlocks:_ drafts that are actually as good as the scaffold already implies, and a QA signal you can trust.

### Phase 1 — Real avatar/spokesperson UGC

- Wire a real avatar provider into the UGC production phase via the existing `heygen-client.ts` seam (HeyGen API is documented + PAYG; Hedra Character-3 as a quality alt), with lip-synced ElevenLabs voice.
- Introduce a **multi-provider routing** layer (fal.ai-style) so Kling/Veo/Seedance/HeyGen are swappable and A/B-able; add **Veo 3.1 Fast** for native synced dialogue.
- _Unlocks:_ Mira produces genuine talking-head UGC, the core of "power" creative — at ~$0.65–$2.15/30s.

### Phase 2 — Close the publish seam (the #1 ROI blocker)

- Build a **"publish creative as PAUSED ad"** path on the already-written `MetaAdsClient.uploadCreativeAsset` + `createDraftAdSet`, as a **governed intent through `PlatformIngress.submit()`** (note: today's Continue/Stop bypass ingress via direct Inngest — autonomous spend MUST be re-routed through the gate).
- Add `metaAdId` / `externalCreativeId` to `CreativeJob` so an asset is linkable to an ad. Keep `updateCampaignStatus("ACTIVE")` human-gated (the existing throw is correct) until trust tiers say otherwise.
- This is the **Mira→Riley/ad-optimizer handoff** that does not exist yet.
- _Unlocks:_ a Mira creative can actually run as an ad. The sentence "this creative is live" becomes true.

### Phase 3 — Close the learning seam (proof + flywheel)

- **Per-creative attribution:** join `creative-analyzer` `video_id` → Mira `AssetRecord` → conversions/ROAS (CAPI is real when env-configured; make events carry the creative id).
- **Populate `CreativeJob.pastPerformance`** from that attribution (it's the designated channel, currently always null).
- **Performance-tagged creative memory** (7-dimension: hook/format/emotion/offer/CTA/visual/specs) → enrich the next brief. **Riley→Mira propagation** (today `refresh_creative` is advice-only, `externalEffect:false`).
- **Enforce `spendApprovalThreshold`** in `GovernanceGate` (stop the stored-not-read footgun).
- _Unlocks:_ "Mira creative X drove $Y at Z ROAS" — answerable. The next brief is smarter than the last.

### Phase 4 — The agent brain + governed autonomy

- Give Mira an actual **agent**: persona + planning + the orchestrator-worker creative team + tools + DeploymentMemory; able to **self-initiate** briefs from performance signals / Riley handoffs and generate at playbook volume under the **tiered cost model**.
- **Graduated autonomy** wired to enforced spend caps and trust tiers; health-claim review always human.
- _Unlocks:_ "autonomous" in the literal sense — Mira runs the create→ship→measure→improve loop with humans on escalation, not in the critical path.

---

## Key risks & invariants

- **Regulated-vertical compliance is a hard gate, not a trust tier.** Medspa/health claims require human sign-off on every creative, every time; the agent composes only from a legal-maintained pre-approved claim library and never invents claims. (FTC substantiation + HIPAA.)
- **Honor the platform invariants.** Everything mutating through `PlatformIngress.submit()`; `WorkTrace` canonical; approval is lifecycle state; human escalation first-class; **no mutating bypass paths** — which means Phase 2+ must fix the current Continue/Stop direct-Inngest bypass, not extend it.
- **Don't trust LLM-as-judge for creative quality** (ρ<0.35 vs human experts). Use human pairwise + leading engagement indicators for winner selection.
- **Cap runaway generation** — tiered generation + circuit breakers; render only finalists; cache concept mappings.
- **Avatar realism / authenticity ceiling** — "too polished" underperforms; bake an authenticity score into QA; expect a residual lip-sync failure rate and gate on it.
- **Governance is the moat, and its absence is a landmine** — Higgsfield's scandal is the cautionary tale for ungoverned autonomous generation at scale. Lean into the thing Switchboard already is.

---

## Bottom line

Mira is one real pipeline, one honest cockpit, and a pile of correctly-shaped seams that were never wired together — **HeyGen stub, discarded scene direction, fake QA, dead `uploadCreativeAsset`, null `pastPerformance`, unenforced spend gate.** The frontier proves the generation half is a solved commodity. The differentiated, defensible product is the **governed closed loop** — and Switchboard is the rare codebase already built to carry it. The path is four phases of mostly-wiring, with Phase 2 (publish) as the hinge on which the entire ROI thesis turns.
