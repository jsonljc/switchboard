# Mira — Current-State Codebase Audit

**Date:** 2026-06-02 · Branch audited: `docs/production-env-checklist`
Four parallel Opus audit lanes: (A) agent definition, (B) generation pipeline, (C) surfaces/read-model/lifecycle, (D) creative→ad→ROI loop. All claims carry file:line evidence.

---

## A. Mira agent definition

Mira is **not a conversational LLM agent like Alex.** She is a thin identity + cockpit wrapper over the `@switchboard/creative-pipeline` package. Three disconnected layers; **no single "brain."**

**Identity & registration**

- `packages/schemas/src/agents.ts:20-27` — `mira: { key:"mira", slug:"mira", role:"creative", displayName:"Mira", accent:"hsl(265 30% 35%)", launchTier:"day-thirty" }`. Day-thirty = opt-in per org, not day-one.
- `packages/core/src/decisions/agent-key-resolver.ts:9-10` maps `"mira"` and `"creative-director"` → `"mira"`.
- Hue is inconsistent across sources of truth: schema `hsl(265 30% 35%)` vs dashboard `globals.css:64` `--agent-mira: 270 45% 58%`.
- **No agent manifest, no skill builder.** The builder registry (`packages/core/src/skill-runtime/builders/index.ts:1-5`) exports only `adOptimizer`, `adOptimizerInteractive`, `alex`, `salesPipeline`, `websiteProfiler` — no `mira`/`creative`. The product `skills/` dir has alex/ad-optimizer/sales-pipeline/website-profiler — **no creative/mira SKILL.md.**

**System prompt & persona**

- **None exists.** No "You are Mira" anywhere. The only prompts are anonymous per-stage role prompts inside the pipeline:
  - `packages/creative-pipeline/src/stages/trend-analyzer.ts:16` "You are an expert performance creative strategist…"
  - `script-writer.ts:18` "You are an expert performance ad scriptwriter…" (fixed 30s Hook/Problem/Solution/Proof/CTA)
  - `storyboard-builder.ts:18` "You are an expert creative director…"
  - `ugc-script-writer.ts:59-83` "You are writing a UGC ad script as ${creator.name}…" — the persona here is a `CreatorIdentity` (a virtual creator), **not Mira.** Load-bearing UGC rules: write like a real person, 15-25% filler-word density, FORBIDDEN ad-speak ("limited time offer", "act now", "click the link below").

**Skills & tools**

- **None of her own.** Two execution paths both write a `CreativeJob` row:
  - **Path A (Mira open brief):** `POST /agents/:agentId/brief` (`apps/api/src/routes/agent-home/mira-brief.ts`) — Mira-only, org-enablement-gated, fails closed without an active `skillSlug="creative"` deployment, fires Inngest `creative-pipeline/job.submitted` with **`mode:"polished"` hardcoded** (`:126-135`).
  - **Path B (Alex→Mira delegation):** `creative.concept.draft` — **DB row only, NO generation, NO LLM, NO spend** (`creative-concept-draft-workflow.ts:140` "NO inngestClient.send — draft-only, no spend").
- Actual generation tools live in Inngest functions, not an LLM tool-loop: polished stages (Claude ×4 + Kling + ElevenLabs + Whisper + FFmpeg + DALL·E 3), UGC pipeline (planning→scripting→production with Claude scripts + Kling video + realism QA).

**Model & inference**

- `stages/call-claude.ts:5` — `DEFAULT_MODEL = "claude-sonnet-4-5-20250514"`, `DEFAULT_MAX_TOKENS = 4096`. **No temperature, no prompt caching, no extended thinking, no memory/DeploymentMemory.** Each stage is one-shot `messages.create` → JSON-extract → Zod-validate.
- Image: OpenAI `dall-e-3` 1024² (`image-generator.ts:24-30`, gated on `OPENAI_API_KEY`). Video: Kling (`kling-client.ts`, gated on `KLING_API_KEY`). Registered in `apps/api/src/bootstrap/inngest.ts:707-748`.

**Inputs/outputs**

- Brief input is deliberately taste-only: `MiraBriefRequestSchema` (`mira-brief.ts:17-22`) = one required `promoting` line + optional `goal` + `vibe` chips. `mapMiraBriefToCreativeBrief` hardcodes `platforms:["meta"]`, `references:[]`, `productImages:[]`, `generateReferenceImages:false`. **The owner gives intent and taste — never platforms or tooling.**
- Output: a `CreativeJob` row surfaced via `MiraCreativeReadModel` as a `MiraCreativeDraft` (`{videoUrl?, thumbnailUrl?, durationSec?}`), reviewed via **Keep/Pass**. Final product = a **video draft parked for human review**, never an auto-published ad.

**Verdict:** real generation primitives, but the "agent" framing is cosmetic. No brain, no autonomy, no learning, no real avatar UGC reachable from her own surfaces. Biggest gap: there is no autonomous creative agent at all.

---

## B. Creative generation pipeline

Two pipelines behind a mode-dispatcher (`mode-dispatcher.ts:44` re-emits `polished.submitted` or `ugc.submitted`). `packages/ad-optimizer/` (Riley) reads ad performance and is **completely decoupled** — it never imports creative-pipeline output.

**Polished** — `creative-job-runner.ts:50`, stages `["trends","hooks","scripts","storyboard","production"]` (`run-stage.ts:45`), each an Inngest `step.run` with a 24h `step.waitForEvent` buyer-approval gate between stages. trends/hooks/scripts/storyboard = real Claude. production = Kling (+ pro-tier ElevenLabs/Whisper/FFmpeg).

**UGC** — `ugc-job-runner.ts:232`, phases `["planning","scripting","production","delivery"]`. planning is deterministic (structure selection + creator casting + identity routing, no LLM); scripting = Claude UGC script + deterministic `SceneStyle`/`UgcDirection`; production = provider rank → generate → realism QA → persist `AssetRecord`; **delivery is a no-op stub.**

**Real-vs-Stub ledger**

| Capability                                  | Status                            | Evidence                                                                                            |
| ------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| Strategy/hooks/scripts/storyboards (Claude) | REAL                              | `trend-analyzer.ts:65`, `hook-generator.ts:84`, `script-writer.ts:104`, `storyboard-builder.ts:103` |
| UGC scripts w/ authenticity rules (Claude)  | REAL                              | `ugc-script-writer.ts:112`, prompt `:59-83`                                                         |
| Storyboard reference images (DALL·E 3)      | REAL, flag-gated                  | `image-generator.ts:24`                                                                             |
| Video clips text/image→video (Kling)        | REAL, key-gated                   | `kling-client.ts:38`; `inngest.ts:137`                                                              |
| Voiceover (ElevenLabs)                      | REAL, pro-tier, polished-only     | `elevenlabs-client.ts:32`; `run-stage.ts:140`                                                       |
| Captions/SRT (Whisper)                      | REAL, pro-tier                    | `whisper-client.ts:63`                                                                              |
| Video assembly + thumbnail (FFmpeg)         | REAL, pro-tier                    | `video-assembler.ts:107`                                                                            |
| Visual prompt optimization (polished)       | STUB (template, not Claude)       | `video-producer.ts:283-307` "Claude optimization can be added later"                                |
| Visual prompt optimization (UGC)            | ABSENT — raw script text used     | `ugc/phases/production.ts:115` `prompt: spec.script.text`                                           |
| Realism/QA "Claude Vision"                  | **FAKE** — URL-as-text, no frames | `realism-scorer.ts:162`, `call-claude.ts:46` sends a plain string                                   |
| Avatar/talking-head (HeyGen)                | STUB — throws                     | `heygen-client.ts:25`; `video-provider.ts:70`                                                       |
| Seedance / Runway video                     | STUB — throws                     | `video-provider.ts:81,92`                                                                           |
| Voiceover in UGC path                       | ABSENT — not wired                | `inngest.ts:748` passes only `klingClient`                                                          |
| Durable asset storage (R2/S3)               | ABSENT — temp files               | `elevenlabs-client.ts:53`, `video-producer.ts:161` TODOs                                            |
| Performance→generation feedback             | STUB — empty memory               | `ugc-job-runner.ts:119,219`; `planning.ts:81,92`                                                    |
| Publish creative as Meta ad                 | ABSENT — no caller                | `meta-ads-client.ts:160` `uploadCreativeAsset` zero callers                                         |
| "premium" production tier                   | ABSENT — unreachable              | type union `video-producer.ts:74`, but `run-stage.ts:131` casts to `"basic"                         | "pro"` only |

**The fake-QA detail matters most:** `evaluateRealism`/`evaluateMinimalQa` claim "Claude Vision" but `buildRealismPrompt` puts only the **video URL as a text string** in the prompt; `callClaude` sends `content: options.userMessage` as a plain string — no frames/images ever attached. Realism/face-similarity/artifact scores are **hallucinated from a URL**, and they gate `approvalState`. `.env.example` defines only ANTHROPIC/OPENAI/KLING/ELEVENLABS keys — no HeyGen/Runway/Seedance, consistent with those being stubs.

**Data model:** `CreativeJob` (Zod `creative-job.ts:198`, Prisma `schema.prisma:1300`) holds brief + pipeline state + UGC state. `CreatorIdentity` (`schema.prisma:1362`) is a "creator bible" (voice/personality/appearance/quality-tier soul_id/identityAdapter LoRA — schema only). `AssetRecord` (`schema.prisma:1401`) is the output (provider/modelId/seed/outputs.videoUrl/qaMetrics/approvalState). Assets are URLs/paths, **not blobs** — no R2 upload wired.

**Verdict:** the copy layer is real and strong; real video is achievable (script→Kling→captioned MP4) with keys; but it is **single-provider, partly stubbed, QA-faked, non-autonomous, and never published.** No "power UGC" avatar video; the computed scene/identity direction and voiceover are not applied in the UGC path.

---

## C. Mira surfaces, read model & lifecycle

**Read model is real, not a fixture.** `MiraCreativeReadModel` (`packages/core/src/creative-read-model/types.ts`) projects persisted `CreativeJob` rows; `prisma-mira-creative-read-model-reader.ts:26-39` does `prisma.creativeJob.findMany({where:{organizationId}, take:200})`. Status union `in_progress|awaiting_review|draft_ready|shipped|stopped|failed` — but `shipped` is **declared and never emitted** ("reserved for a later publish phase", `build-read-model.ts:49-50`). `desk-model.ts:8-16` makes Phase-4/5 ship states (`sent_to_riley`, `in_use`, `published`, `winner`, `fatigued`) **type-unrepresentable** by design.

**Surfaces** (all live-data-wired; no `NEXT_PUBLIC_*` Mira flags, no demo branches): `/mira` Director's Desk (`mira-desk-page.tsx`) with brief box (mutating → create draft), ready-to-review hero, in-production tray, Keep shelf (mutating → un-keep); `/mira/review` TikTok feed (`mira-feed-page.tsx` / `mira-creative-feed.tsx` / `mira-clip-card.tsx`); `/mira/creatives/[id]` detail (banner: _"Draft only — not published. Nothing goes live without you."_); agent-panel drill-in (`mira-panel.tsx`, enablement-aware, **no pause, no autonomy knobs**).

**Two independent mutation axes** (contradicting the prior "everything rides /approve→ingress" note):

- **Continue/Stop** → `useApproveStage` → `POST /creative-jobs/:id/approve` (`creative-pipeline.ts:146-217`) — **does NOT go through PlatformIngress**; fires Inngest `stage.approved`/`ugc-phase.approved` directly, or `jobStore.stop()`.
- **Keep/Pass/un-keep** → `useReviewDecision` → `mira-decision.ts:40-71` — writes only `CreativeJob.reviewDecision` via org-scoped `updateMany` + `count===0`→404, firewalled from Riley.

**Lifecycle:** producers (Mira brief fires pipeline / Alex delegation fires nothing / legacy marketplace) → `in_progress` → `awaiting_review` (videoUrl present) → `draft_ready` (complete) → Keep (shelf, reversible) | Pass (dismiss) | stopped | failed. Terminal pipeline stage is `complete` — **no publish step exists.**

**Verdict:** a genuinely live, real-data draft-triage cockpit with an **enforced** draft-only guarantee (no publish path, `shipped` never emitted, ship-states unrepresentable, route-allowlisted as non-ingress). Autonomy gaps: no produce→ship mechanism, Keep doesn't launch anything, generation spend bypasses GovernanceGate, no autonomy controls, brief origination is human/Alex-only.

---

## D. Creative → ad → ROI loop

**Loop completeness**

| Stage                      | Status                      | Evidence                                                                                                                                                                                            |
| -------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handoff Alex→Mira          | EXISTS-LIVE (draft-only)    | `delegate.ts:40-117`; `delegation-targets.ts:7-45`; needs seeded `skillSlug="creative"` deployment (`seed-mira-creative-deployment.ts:28-58`)                                                       |
| generate                   | EXISTS-LIVE                 | UGC `production.ts:112-159` persists `AssetRecord.videoUrl`; fired via `/mira` brief, NOT via Alex draft (`creative-concept-draft-workflow.ts:140`)                                                 |
| approve (creative)         | EXISTS-LIVE (internal only) | `creative-job-decision-workflow.ts:51-62` advances pipeline; no approval to go _live_                                                                                                               |
| **push-to-ad**             | **ABSENT**                  | `uploadCreativeAsset`/`createDraftCampaign`/`createDraftAdSet` zero non-test callers; `updateCampaignStatus("ACTIVE")` throws (`meta-ads-client.ts:176`); no `metaAdId` on `CreativeJob`            |
| measure-perf               | FLAGGED-OFF / READ-ONLY     | CAPI live only if `META_CAPI_ACCESS_TOKEN` set (`conversion-bus-bootstrap.ts:54-79`); `OutcomeDispatcher` DORMANT; insights are read-only pulls                                                     |
| attribute-per-creative     | ABSENT for Mira             | `creative-analyzer.ts:35-60` ranks creatives _already on Meta_ by `video_id`; no link from Mira asset → Meta ad; CAPI events carry no creative id                                                   |
| learn (perf→next creative) | ABSENT                      | `pastPerformance` always `null` (`mira-brief.ts:117`, `creative-concept-draft-workflow.ts:136`); learning loop extracts only `booked` _conversation_ patterns (`outcome-pattern-extractor.ts:4-17`) |
| propagate Riley→Mira       | ABSENT                      | `refresh_creative` is advice-only `externalEffect:false` (`recommendation-sink.ts:126`); cross-agent surface = read-only Decision inbox                                                             |

**Key facts:**

- `MetaAdsClient` has the building blocks — `createDraftCampaign` (`:129`, PAUSED), `createDraftAdSet` (`:147`, PAUSED), `uploadCreativeAsset` (`:160`, POSTs `/adimages`|`/advideos`), `updateCampaignStatus` (`:174`, **throws on ACTIVE**: "SAFETY: Agent cannot activate campaigns. Human must publish via Ads Manager."). All write methods have **only test callers**; the client is instantiated only for **reads** (insights/reporting).
- The produced `AssetRecord.videoUrl` is referenced outside its writer in exactly two read-only places (the assetStore wiring `inngest.ts:749`, the `/mira` feed renderer `creatives.ts:28,34`). It is never passed to `uploadCreativeAsset`.
- Governance: the draft handoff is `approvalMode:"system_auto_approved"`, `allowedTriggers:["internal"]` (`contained-workflows.ts:202-213`) — auto-approved _because it has no outbound effect_ (comment warns "Spend-bearing targets must NOT copy this"). `spendApprovalThreshold` is resolved (`prisma-deployment-resolver.ts:28`) but **never read** by `GovernanceGate` (which uses `trustLevelOverride` only). `TrustScoreAdapter` is consumed but scores marketplace-listing trust from recommendation outcomes, **not** ad ROAS.

**Verdict:** the front half (delegate → generate → approve) is real and governed; the loop is **hard-broken at push-to-ad (#1 blocker)** and **at learn/propagate (#2 blocker)**; attribution is real but mis-grained (account/pixel-level, no creative id). "Mira creative X drove $Y at Z ROAS" is aspirational — every link is missing. Highest-leverage order: (1) publish-as-paused-ad on the existing client methods + add `metaAdId`; (2) per-creative attribution joining `video_id`→asset→ROAS; (3) populate `pastPerformance` + Riley→Mira propagation (inert until #1).
