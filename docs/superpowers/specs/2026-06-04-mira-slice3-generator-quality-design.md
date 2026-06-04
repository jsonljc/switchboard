# Mira Slice 3: De-stub Generator Quality (real frame-QA, direction-faithful prompts, reachable UGC, real avatar seam)

> Status: design spec for slice 3 of the canonical Mira roadmap
> (`docs/superpowers/specs/2026-06-03-mira-roadmap.md`, PR #858). Consumes that roadmap; resolves
> its section-7 open questions for slice 3 (avatar provider selection and the multi-provider
> routing seam).
>
> Date: 2026-06-04. Base: `origin/main` @ `67e64c82`. Author: Claude (autonomous session).

## 1. Goal

Make the existing pipeline tell the truth, now that the loop can measure which quality levers
matter (slice 2 shipped attribution + taste memory). Four legs, per the roadmap:

1. **Real frame-QA.** Extract actual video frames and send them to the vision model as image
   content blocks. Flip the honest-stub plug point (`qaStatus: "evaluated"` + `computeDecision`);
   `deriveApprovalState` then gates on a real result. Never a URL-as-text (the pre-#809 sin).
2. **Use the computed direction.** `SceneStyle` / `UgcDirection` are computed at scripting and
   attached to every UGC spec, then discarded at the prompt boundary: production sends raw
   `spec.script.text` to Kling. Compose them into the video request instead.
3. **Make UGC mode reachable** from Mira's product surfaces, end to end: submit, phase approvals,
   spend governance, review, publish.
4. **Real avatar UGC** via the existing `heygen-client.ts` seam (the audit's P1 folds in here).
   Multi-provider routing infrastructure already exists (`rankProviders`); no new routing engine.

Plus one truth fix discovered while grounding: pro-tier captions authenticate to OpenAI with the
Anthropic key and 401 on every call (silently swallowed into the errors array), so no assembled
video has ever had captions.

## 2. Verified current state (grounded against origin/main @ 67e64c82, 2026-06-04)

| Fact | Evidence |
| --- | --- |
| `evaluateRealism` / `evaluateMinimalQa` are honest stubs returning `qaStatus: "requires_human_review"`; the decision helpers (`computeDecision`, `computeWeightedSoftScore`, `deriveApprovalState`) are real and tested; approval requires `evaluated` AND `pass` | `packages/creative-pipeline/src/ugc/realism-scorer.ts:130-159`, `ugc/minimal-qa.ts:23` |
| `evaluateRealism` is called from exactly one live site: the UGC production phase, which persists every generated asset with `approvalState: deriveApprovalState(qaScore)` | `packages/creative-pipeline/src/ugc/phases/production.ts:111,139` |
| `AssetRecord.approvalState` has NO live consumer: nothing reads it (the desk's `deriveUgcDraft` surfaces `assets[0]` regardless; grep hits elsewhere are the unrelated platform `ApprovalState`) | `packages/core/src/creative-read-model/status-mapper.ts:89-120`; repo-wide grep |
| UGC production prompts are raw script text: `videoProvider.generate({ prompt: spec.script.text, durationSec, aspectRatio })`; the request type already supports `referenceImageUrl`, `negativePrompt`, `cameraMotion`, all unused | `production.ts:104-108`, `ugc/video-provider.ts:5-12` |
| `SceneStyle` (lighting, camera angle/movement, environment, wardrobe, hair) and `UgcDirection` (hookType, eye contact, energy, pacing, imperfections, adLibPermissions, forbiddenFraming) are computed deterministically at scripting and attached to each spec as `style` / `direction`; production's `CreativeSpecInput` omits both fields | `ugc/ugc-director.ts:161-190`, `ugc/phases/scripting.ts:138-172`, `production.ts:14-27` |
| `generateDirection` throws on creators with empty `environmentSet` / `hairStates` (`pickFrom` on empty array), so the PCD backfill's placeholder stock creator (empty arrays) would crash the scripting phase if cast | `ugc-director.ts:60-69,164-172`, `apps/api/src/bootstrap/inngest.ts:739-757` |
| `rankProviders` ignores `spec.providersAllowed`; for `talking_head` + `reference_conditioning` HeyGen scores 1.95 vs Kling 1.9, so production tries the throwing HeyGen adapter first and burns `maxAttempts` before falling back | `ugc/provider-router.ts:100-128,135-165`, `production.ts:211-215` |
| Both HeyGen seams throw: the `stages/heygen-client.ts` class and the `createHeyGenAdapter` in `ugc/video-provider.ts`; Seedance/Runway adapters also throw and are `apiMaturity: "low"` (excluded from ranking) | `stages/heygen-client.ts:24-26`, `ugc/video-provider.ts:67-96`, `provider-router.ts:141` |
| The governed submit path is mode-aware end to end: `POST /creative-jobs` accepts `mode: z.enum(["polished","ugc"]).default("polished")` and forwards it; the submit workflow branches `createUgc` (with `ugcConfig`) vs `create`; the mode dispatcher routes `job.submitted` to `polished.submitted` / `ugc.submitted`; the UGC runner is registered with jobStore/creatorStore/deploymentStore/llm/kling/assetStore deps | `apps/api/src/routes/creative-pipeline.ts:20,87-94`, `services/workflows/creative-job-submit-workflow.ts:71-89`, `packages/creative-pipeline/src/mode-dispatcher.ts`, `bootstrap/inngest.ts:948-976` |
| The Mira surfaces pin polished: `mira-brief.ts` hardcodes `mode: "polished"` in its ingress params; `MiraBriefRequestSchema` has no mode field; the desk brief box poses promoting/goal/vibe only | `apps/api/src/routes/agent-home/mira-brief.ts:126-138`, `packages/schemas/src/mira-brief.ts:17-21` |
| BROKEN: the submit workflow stores the RAW brief as `ugcConfig` (`ugcConfig: brief`, unwrapped), but the runner reads `ugcConfig.brief`, which is therefore always undefined: every UGC phase would run on an EMPTY brief (productDescription "", platforms [] with a meta_feed fallback). `UgcConfigSchema` defines the intended `{brief, budget?, retryConfig?}` shape and nothing enforces it; `UgcBriefSchema` (with `ugcFormat`, `creatorPoolIds`) extends `CreativeBriefInput`, which itself carries neither field | `creative-job-submit-workflow.ts:71-77`, `ugc-job-runner.ts:104-105,126-127`, `packages/schemas/src/ugc-job.ts:42-59` |
| The seeded creative listing (`performance-creative-director`) has `trustScore: 0` and is excluded from the demo trust-recompute loop, so `shouldRequireApproval` (thresholds 55/55/80/80) gates ALL FOUR UGC phases; each gate needs an operator continue | `packages/db/prisma/seed-marketplace.ts:510-525,654`, `ugc/approval-config.ts:12-33`, `ugc-job-runner.ts:303-309` |
| Pre-video approval gates have no operator navigation path: the review feed lists only video-bearing jobs (`isReviewable` requires `draft.videoUrl`, `apps/api/src/routes/agent-home/creatives.ts:24-30`); the in-production tray is purely presentational (no links); BUT the detail page itself already renders Continue/Stop from the read model's `reviewAction.canContinue`, which is true for ANY `awaiting_review` job, video or not. The gap is navigation, not capability. Polished jobs share it (their trends/hooks/scripts/storyboard gates are equally tray-invisible; demo seeds masked this) | `creatives.ts:24-30`, `components/cockpit/mira/mira-in-production-tray.tsx`, `app/(auth)/mira/creatives/[id]/creative-detail-page.tsx:15,140-146`, `creative-read-model/status-mapper.ts:43-56` |
| LATENT: governed approve can never resume a waiting UGC pipeline. The runner persists `ugcPhase = nextPhase` BEFORE waiting on `if: async.data.phase == '<currentPhase>'`; the decision workflow emits `phase: job.ugcPhase` (the persisted NEXT phase); the condition never matches; the wait times out at 24h and stops the job. The polished wait matches on `data.jobId` only (no stage condition) and works | `ugc/ugc-job-runner.ts:283-315`, `services/workflows/creative-job-decision-workflow.ts:60-70`, `creative-job-runner.ts:150-154` |
| The governance spend signal is polished-only: `computeRenderSpend` derives from `stageOutputs.storyboard` (null for UGC, which writes `ugcPhaseOutputs`), so a UGC continue would carry no `spendAmount` and the #788 threshold lever no-ops | `apps/api/src/services/creative-render-spend.ts`, route wiring `routes/creative-pipeline.ts:190-198` |
| The continue/stop guard is polished-only: `currentStage === "complete" \|\| stoppedAt` (a UGC job's `currentStage` stays at the column default) | `creative-job-decision-workflow.ts:28-37` |
| `assertPublishable` hard-requires `job.durableAssetUrl`; only the polished pro-tier assembly seam produces it (`save-durable-asset` step on `VideoProducerOutput.durableAssetUrl`); no UGC path sets it, so a kept UGC creative is permanently publish-blocked (`CREATIVE_ASSET_NOT_DURABLE`) | `services/creative-publish-preconditions.ts:59-105`, `creative-job-runner.ts:136-144`, `stages/video-producer.ts:259-278` |
| UGC asset video URLs are provider CDN URLs persisted as-is (`outputs.videoUrl = result.videoUrl`); nothing durably stores UGC bytes | `production.ts:133,144-147` |
| Pro-tier captions are broken: `run-stage.ts` constructs `WhisperClient({ apiKey: input.apiKey })` where `apiKey` is `ANTHROPIC_API_KEY` (bootstrap:179), but the client calls `api.openai.com/v1/audio/transcriptions` with `Authorization: Bearer <that key>`; the 401 lands in the errors array and `captionsUrl` stays empty. The DALL-E generator next to it correctly uses `openaiApiKey` | `stages/run-stage.ts:151-158`, `stages/whisper-client.ts:9,63-65`, `bootstrap/inngest.ts:179-188` |
| `call-claude.ts` is text-only (`content: options.userMessage` string); no image-block path exists | `stages/call-claude.ts:42-47` |
| The L2 package already shells ffmpeg and does SSRF-gated, size-capped downloads (`VideoAssembler.downloadClips` + `isSafeUrl` + `readBodyWithLimit`; thumbnail extraction via `-ss 1 -vframes 1`) | `stages/video-assembler.ts:107-180`, `util/safe-url.ts` |
| `estimateCost(storyboard, scriptCount)` is the single source for the polished spend signal AND the `GET /creative-jobs/:id/estimate` readback ({basic, pro} tiers); UGC has only an internal `ugcConfig.budget.totalJobBudget` guard (default 50) that counts PERSISTED assets at the router's placeholder per-clip costs, not attempts | `stages/cost-estimator.ts`, `creative-render-spend.ts`, `production.ts:204-209`, `provider-router.ts:91-96` |
| The read model is already UGC-aware for status + draft (`ugcFailure`, `ugcPhase`, `deriveUgcDraft` from delivery/production outputs); the feed's reviewability gate lives in the route (`isReviewable`, requires `draft.videoUrl`); the taste sweep and history extractor branch on mode but pass `job.stageOutputs`, so UGC descriptors land in the `none` bucket (`taste:kept_ugc_none`) | `creative-read-model/status-mapper.ts:23-56,89-120`, `apps/api/src/routes/agent-home/creatives.ts:24-30`, `apps/api/src/services/cron/creative-taste-sweep.ts:211`, `services/workflows/creative-performance-history.ts:38`, `packages/creative-pipeline/src/creative-descriptor.ts` |
| `CreatorIdentity` carries `identityRefIds: string[]`, `heroImageAssetId`, `voice {voiceId, provider}`, optional `qualityTier` (`stock \| anchored \| soul_id`); `seed-mira-creative-deployment.ts` seeds no creators; `castCreators` returns `[]` on an empty pool, so a creator-less deployment completes a UGC job with zero assets, silently | `packages/schemas/src/creator-identity.ts:46-81`, `ugc/scene-caster.ts:60-89`, `packages/db/src/seed/seed-mira-creative-deployment.ts` |
| Slice-2 interactions: the taste provider threads into the POLISHED runner only (6th param); submit-time history enrichment is mode-agnostic (runs before the mode branch); the attribution sweep joins on `metaCampaignId` (publish-level, mode-agnostic) | `creative-job-runner.ts:84-99,170-198`, `creative-job-submit-workflow.ts:42-55` |

## 3. Decisions

### 3.1 Real frame-QA: an injected frame evaluator behind the honest-stub contract

**Where frames come from.** A new `FrameExtractor` capability in `packages/creative-pipeline`
(L2; shelling ffmpeg from L2 is the established precedent: `VideoAssembler`). Given a video URL
or local path:

1. If remote: validate through `defaultSafeUrlPolicy()` (SSRF guard + size cap), download to a
   temp file (the `downloadClips` pattern).
2. Extract N frames as JPEGs via ffmpeg (`-vf fps=...` evenly spaced across the clip; N = 8 for
   a 5-10s clip, constant pinned in the module). First and last frames are included by
   construction of the spacing.
3. Return base64 JPEGs PLUS the local video path, so later steps (durable upload, 3.4) reuse the
   downloaded bytes instead of re-fetching.

**The vision call.** `stages/call-claude.ts` gains an images-capable variant
(`callClaudeWithImages`): same client, same `extractJson` + zod-parse conventions, content blocks
`[{type:"image", source:{type:"base64", media_type:"image/jpeg", data}}..., {type:"text", text}]`.
The text-only `callClaude` callers stay byte-identical.

**What the model judges: objective integrity ONLY.** Hard invariant (roadmap + audit, LLM-judge
aesthetic correlation under 0.35): frame-QA gates whether the video is technically sound, never
whether it is creatively good. The QA prompt is pinned to:

- **Artifact flags** from a bounded vocabulary: `face_drift`, `product_warp`, `hand_warp` (the
  existing critical set) plus `garbled_text`, `broken_frame`, `anatomical_error`. Anything else
  the model wants to flag goes into a free-text notes field that gates nothing.
- **Presence checks**: a human subject is visible when the format expects one (`talking_head`);
  legible overlay text matches the expected overlay when one was requested (`ocrAccuracy`,
  populated only when expected text is provided; otherwise left undefined and the threshold
  check skips it, as `computeDecision` already does).
- **`faceSimilarity`**: populated only when a creator reference image is provided
  (`creatorReferenceUrl`, already on `RealismScorerInput`); v1 passes none (creator hero images
  are asset ids without a resolver), so the check stays undefined/skipped. The seam is the
  existing input field; no new plumbing.
- **Soft scores**: `visualRealism`, `behavioralRealism`, `ugcAuthenticity` scored as INTEGRITY
  dimensions (coherent motion across frames, no uncanny rendering, handheld-native framing),
  with the prompt explicitly forbidding aesthetic-appeal judgment. `audioNaturalness` is NEVER
  populated from frames (frames carry no audio); it stays undefined.

**Renormalization (the one decision-logic change).** `computeWeightedSoftScore` currently treats
absent dimensions as 0, which means a frame-only evaluation (no `audioNaturalness`) maxes out at
0.75 of the weight mass, and any absent pair that includes `ugcAuthenticity` (weight 0.35) makes
the 0.5 threshold unreachable outright. That skew would make `evaluated` + `pass` either
unreachable or arbitrarily harder depending on which dimensions a frame evaluator can honestly
score, which is backwards. The function renormalizes over PRESENT dimensions:
`sum(w_i * s_i present) / sum(w_i present)`; all-absent returns 0 (review). Hard-check gating is
unchanged. This is an explicit contract change for partial inputs: the existing
`handles partial scores` unit test (`__tests__/realism-scorer.test.ts:42-46`, asserts
`{ugcAuthenticity: 1.0}` scores 0.35) updates to the renormalized value (1.0), and the
`treat as 0` test name updates to describe the all-absent rule. The absent-as-0 behavior was a
defense for the fabricated-score era; the real safety is `deriveApprovalState`'s `qaStatus`
gate, which is untouched. Full-set scores are arithmetically identical.

**The evaluator.** `evaluateRealism(input, deps?)` gains an optional deps parameter
`{ frameExtractor, vision }`. The live wiring point is the production phase itself: it already
holds `deps.apiKey`, so it self-constructs the frame extractor (pure L2 module reading
`defaultSafeUrlPolicy()` from env) and the vision function (`callClaudeWithImages` bound to that
key) and passes both to `evaluateRealism`. No new runner or bootstrap plumbing. A
production-phase test asserts the evaluator is invoked WITH deps in the live path, so a future
refactor cannot silently fall back to the stub (the built-but-unwired trap). Behavior:

- Deps absent (any caller not yet wired), download failure, ffmpeg failure, vision-call failure,
  or schema-invalid model output: return the CURRENT honest-stub result
  (`qaStatus: "requires_human_review"`, `overallDecision: "review"`), with the failure recorded
  in the asset's `qaHistory` entry. QA infrastructure problems must never block or fail the
  pipeline; they route to a human, exactly like today.
- Deps present and the chain succeeds: `qaStatus: "evaluated"`, hard/soft checks populated as
  above, `overallDecision = computeDecision(score)`. `deriveApprovalState` is byte-untouched and
  now does its real job.

`evaluateMinimalQa` stays an honest stub (retained for API compatibility, per its header).

**Consumers, in the same PR** (`AssetRecord.approvalState` currently has zero readers; a real
evaluator with no consumer would be built-but-unwired):

1. **Retry-on-fail in production.** Today the QA verdict cannot fail an asset, so `processSpec`
   returns success on first generation. With a real evaluator: a `fail` decision (critical
   artifact / hard-check breach) does NOT return; it records the attempt in `qaHistory` and
   continues the existing retry/fallback loop (same bounds: `maxAttempts` per provider,
   `maxProviderFallbacks`). If all attempts exhaust with only failing assets, persist the LAST
   asset with `approvalState: "rejected"` (write-once-then-enrich preserved; nothing silently
   dropped) AND record a `failedSpecs` entry with reason `qa_failed`. `review` and `pass`
   verdicts persist and return as today.
2. **Attempt-accurate budget accounting.** Each `generate` attempt (not each persisted asset)
   accrues the provider's estimated per-clip cost into the production budget accumulator, so
   `totalJobBudget` actually bounds worst-case retry spend. (Today only persisted assets count,
   which under-counts failed attempts; QA-retry would widen that hole.)
3. **The desk surfaces the verdict.** `deriveUgcDraft` prefers the first non-`rejected` asset
   (falling back to `assets[0]` when all are rejected, so the operator can still see what
   failed). `MiraCreativeJobSummary` gains an optional `qa` projection
   (`{ status: QaStatus, decision: RealismDecision } | undefined`, UGC assets only, parsed
   defensively from the persisted `qaMetrics`), and the /mira detail surface renders one line:
   "Frame QA: passed (evaluated)" / "Frame QA: needs your eyes" / nothing when absent. Taste
   stays the human's job; the line is labeled as technical QA.
4. **All-rejected jobs read as failed, not reviewable.** A completed UGC job whose production
   assets are ALL `rejected` maps to status `failed` in the status-mapper (rule guarded on the
   production output existing; assets parsed defensively), so it never enters the review feed
   as a clean draft; the detail page still shows the fallback asset and the QA line for
   transparency. Such a job also gets no `durableAssetUrl` (3.3e takes the first non-rejected
   asset), so even a manual Keep leaves publish loud-blocked: designed, stated behavior.

**Cost and model.** One vision call per generated asset (8 frames, maxTokens small), roughly
cents per evaluation vs dollars per render. Model: the existing `DEFAULT_MODEL` in
`call-claude.ts` (vision-capable). No new env var (reuses `ANTHROPIC_API_KEY`).

**Two NEW operational prerequisites for the UGC path** (today UGC never shells ffmpeg or
downloads anything; only the polished pro tier does): ffmpeg on the api host, and the provider
CDN host (Kling) present in `CREATIVE_PIPELINE_ALLOWED_HOSTS`. Both get a runbook entry in the
PR. Missing either degrades QA to `requires_human_review` and the pipeline proceeds, but note
the 3.3e coupling: the same download feeds durable storage, so a missing allowlist entry ALSO
means no durable UGC asset and a publish that stays loud-blocked (`CREATIVE_ASSET_NOT_DURABLE`).
The degrade is honest at every layer, but a misconfigured host list turns into "UGC can never
publish," which the runbook entry exists to prevent.

**Step granularity (stated, not changed).** All production work runs inside the single
`step.run("phase-production")` step: an in-phase failure (or function-level retry) re-runs the
ENTIRE phase, re-issuing every paid render plus the new vision calls and uploads. That is the
pre-existing contract; QA widens the per-retry cost but the deterministic durable key keeps
uploads idempotent and the budget accumulator caps a single execution. Per-asset `step.run`
checkpointing is the named mitigation if render-retry cost ever becomes real, out of scope here.

**Scope boundary.** Frame-QA lands in the UGC production path, where the
`approvalState` seam lives. The polished pipeline keeps its per-stage human approvals (the
operator watches every draft in review); wiring the same evaluator into polished assembly as an
informational badge is mechanical once wanted, and is out of scope here (roadmap language names
the UGC plug point).

**Rejected: thumbnail-only QA** (one frame cannot see temporal artifacts, the dominant failure
class). **Rejected: sending the video file/URL to the model** (the API does not accept video;
URL-as-text is the exact pre-#809 sin). **Rejected: re-tuning weights instead of renormalizing**
(magic numbers per evaluator generation; renormalization generalizes to any subset).

### 3.2 SceneStyle / UgcDirection into the video request

A pure `buildUgcVideoRequest(spec)` in `packages/creative-pipeline` composes what scripting
already computed:

- **prompt**: script text, then a scene sentence (lighting, camera angle, camera movement,
  environment, wardrobe, hair state), then a direction sentence (energy level, eye contact,
  pacing note), then terse authenticity cues derived from the imperfection profile (e.g.
  "natural pauses and small restarts, unpolished delivery"). Bounded length; deterministic.
- **negativePrompt**: `direction.forbiddenFraming` joined with the standard artifact suffix the
  polished optimizer already uses ("blurry, low quality, distorted, watermark, text artifacts").
- **cameraMotion**: mapped only where the provider vocabulary supports it (`slow_pan` to
  `pan_right`; `handheld` / `static_tripod` / `none` map to undefined and the prompt TEXT carries
  the style cue). Kling's `camera_control` accepts the polished extractor's vocabulary
  (`zoom_in`, `zoom_out`, `pan_left`, `pan_right`, `orbit`).
- **referenceImageUrl**: `brief.productImages[0]` for the `product_in_hand` format ONLY
  (image2video uses the image as the first frame; grounding a talking-head video on a product
  still would hijack the scene). Other formats stay text-to-video.

Production parses `style` / `direction` off the spec with `SceneStyleSchema` /
`UgcDirectionSchema` `.safeParse` (parse-don't-cast; the fields already ride the spec from
scripting). Absent or unparseable: fall back to today's raw-script prompt, so legacy specs and
hand-built fixtures keep working.

**`providersAllowed` becomes honored here.** Production filters `rankProviders` output to the
spec's `providersAllowed` (every live spec says `["kling"]`). This is a correctness fix
independent of avatars: today HeyGen outranks Kling for talking-head specs (1.95 vs 1.9) and
production burns `maxAttempts` throwing on the stub adapter before falling back. Empty
intersection: the spec fails with an explicit `no_allowed_provider` reason, never a silent skip.

**Rejected: LLM prompt optimization for UGC** (the polished `createPromptOptimizer` is itself
still template-based; deterministic composition is testable and free). **Rejected: reference
images for talking_head** (first-frame semantics make it wrong, not just useless).

### 3.3 UGC mode reachable, engine first (the governed loop must actually run)

Six defects stand between "the route accepts ugc" and "ugc works"; all six are engine-side and
land in one PR with the existing governed route as the live consumer (proven by a loop-closing
test: submit ugc through the REAL route, run phases with mocked providers, approve through the
REAL decision workflow, see the pipeline resume, complete, and surface a reviewable draft).
Until the surface PR (3.4) lands, UGC phase approvals are exercised through the governed API
route; 3.4 then completes the operator loop in the desk.

**(a) The approval-resume fix.** The UGC runner's `waitForEvent` drops its `if` phase condition
and matches on `data.jobId` only: exact parity with the polished wait, which is the
battle-tested contract (`creative-job-runner.ts:150-154`). The decision workflow keeps emitting
`phase` in the event payload (observability), but nothing string-matches it. Waits are
sequential (one active wait per job), so the jobId-only match cannot skip a later gate: an
approve emitted while planning waits is consumed by the planning wait; an event arriving before
the next wait registers is dropped by Inngest, same as polished.

One newly-activated redundancy, kept deliberately: on `stop`, the decision workflow writes
`stopUgc(job.ugcPhase)` BEFORE emitting (so the UI reflects the stop immediately), and the
runner, now actually receiving the event, writes `stopUgc(<its loop phase>)` again. Polished
has the identical double-write (`jobStore.stop` in the workflow, `jobStore.stop` in the
runner). Both set `stoppedAt` (the only flag that matters); the phase values differ by one
position, benignly. Documented as polished parity, not changed.

Rejected: the decision workflow computing the runner's awaited phase (`prevPhase(job.ugcPhase)`)
couples an app-layer workflow to the phase-order table. Rejected: matching on the persisted
next-phase value (the operator gesture would carry `phase: "complete"` after delivery, which is
semantically absurd and trips the next person who reads the logs).

**(b) The spend producer.** `estimateUgcCost(specs)` joins `estimateCost` in
`stages/cost-estimator.ts` as the single source of UGC render cost: per spec, duration-mapped
Kling pricing (the existing 0.35/0.70 constants); description "N UGC clips via <providers>".
The provider-router's internal `ESTIMATED_COST.kling` (0.5 flat today) aligns to the same
constants in this PR, because production's budget accumulator uses the router value and the
governance signal must not disagree with it from day one (PR-4 then only adds the HeyGen
constant plus a parity test).

`computeRenderSpend` becomes mode-aware, and the UGC leg is gated on the EXACT spend-commit
approve: spend attaches only when `job.ugcPhase === "production"` (the runner persists the
NEXT phase before each wait, so `ugcPhase === "production"` uniquely identifies "the operator
is approving INTO production"). Deriving from spec presence alone would be wrong twice over:
before scripting completes there are no specs (null, fine), but AFTER production runs the specs
are still present while the job waits at the production gate (`ugcPhase === "delivery"`), and
attaching `spendAmount` there would park the operator for money ALREADY spent (a false park
the moment a job's estimate crosses the $15 seeded threshold). The estimate readback
(`GET /creative-jobs/:id/estimate`) gains the same UGC leg through `computeCreativeEstimates`
in THIS PR, returning both tier slots populated with the single untiered estimate plus a
`mode` field, so the existing dashboard reader (`estimateQ.data.basic.cost`) is numerically
correct the moment UGC is reachable; the surface PR (3.4) only suppresses the tier picker. Per
the producer-population rule, this ships in the SAME PR that makes UGC reachable, with a test
driving the REAL `computeRenderSpend` from a seeded scripting output through the REAL governance
gate fixture (the #817 pattern), including the negative case (the delivery-gate approve carries
NO spendAmount).

Note on bounds honesty: the governance estimate is the 1x expected cost (same epistemics as the
polished estimate, which also models zero retries). The worst-case retry spend is bounded
inside production by the attempt-accurate budget accumulator from 3.1 against
`ugcConfig.budget.totalJobBudget`. The spec records this division: governance parks the expected
spend; the job budget caps the tail.

**(c) The guard.** `creative-job-decision-workflow`'s not-awaiting check becomes mode-aware: a
UGC job is not awaiting approval when `ugcPhase === "complete"`, `stoppedAt` is set, OR
`ugcFailure != null` (the polished `currentStage === "complete"` check stays for polished).
`failUgc` sets `ugcFailure` + `ugcPhase` but never `stoppedAt`, so without the third condition
an approve on a FAILED job passes the guard, emits an event no wait is listening for, and
returns a misleading `approved` success. The Mira UI never offers it (`failed` status maps to
`canContinue: false`) but the raw governed route would accept it.

**(d) The submit workflow constructs a VALID `UgcConfig`.** Today it stores the RAW brief as
`ugcConfig` (`ugcConfig: brief`, `creative-job-submit-workflow.ts:73-76`), while the runner
reads `ugcConfig.brief`: always undefined, so every phase would run on an EMPTY brief
(productDescription "", platforms []). The workflow's ugc branch builds and
`UgcConfigSchema.parse`-validates the intended shape:
`{ brief: { ...rawBrief, ugcFormat: "talking_head", creatorPoolIds: [] }, budget: undefined,
retryConfig: undefined }` (runner defaults then apply: budget 50, retries 3/2). `ugcFormat` is
a v1 constant at this single construction site; surfacing it as an operator choice is a named
follow-on once a second format earns its place. A regression test pins that the brief the
PLANNING phase actually receives carries the submitted productDescription (the empty-brief bug
class).

**(e) Creators exist.** Two complementary fixes:

- `seed-mira-creative-deployment.ts` seeds ONE default creator on the Mira creative deployment
  (idempotent: find-by-deployment-and-name before create). Synthetic persona (no real-person
  likeness), `qualityTier: "stock"`, non-empty `environmentSet` / `hairStates` /
  `wardrobePalette` (medspa-appropriate constants), conversational energy, the default
  ElevenLabs voice id the pipeline already uses. Kling t2v consumes no identity fields, so a
  synthetic stock creator is safe by construction; HeyGen (3.5) requires an explicit
  `identityRefIds` entry the seeded creator does not have, so avatar routing cannot pick it up
  accidentally.
- `generateDirection` stops throwing on empty creator arrays: `pickFrom` falls back to neutral
  constants (environment "bright clinic interior", hair "natural", wardrobe selection empty)
  instead of crashing the scripting phase. The PCD backfill's placeholder creator stops being a
  scripting landmine (defense in depth; it can still be cast today).

Without creators, `castCreators` returns `[]`, scripting emits zero specs, and the job completes
with nothing: reachable-but-empty, the silent kind of broken.

**(f) Durable UGC assets.** Production gains an optional `assetStorage?: AssetStorageClient`
dep (the exact polished layering: interface owned by creative-pipeline, S3 impl injected from
bootstrap). The wiring is enumerated because the names collide: `UgcPipelineDeps` gains
`assetStorage?` (distinct from its existing `assetStore`, the AssetRecord persistence),
threaded `preloadContext` to context to `ProductionDeps`, and the bootstrap UGC runner deps
block passes the SAME `buildCreativeAssetStorage(app.log)` instance the polished runner already
receives (`bootstrap/inngest.ts:936` vs the ugc block at `:948-966`, which today lacks it).
After QA, the already-downloaded local file (3.1 returns it) uploads to the
deterministic key `creative-assets/<jobId>/ugc-<specId>.mp4` (specId is created at scripting
and stable across production retries, so a retry overwrites idempotently);
`outputs.videoUrl` becomes the durable URL (provider URL kept as `outputs.sourceUrl`, additive
optional field on `AssetOutputsSchema`). After the production phase, the runner sets
`CreativeJob.durableAssetUrl` to the first non-rejected asset's durable URL via the existing
`setDurableAsset` store method (mirroring the polished `save-durable-asset` step; the runner's
`UgcJobStore` interface gains the method), making a kept UGC creative publishable through the
UNTOUCHED publish path. Zero non-rejected assets: no durable URL, and the job reads `failed`
(3.1 consumer rule), so nothing kept-but-unpublishable masquerades as healthy. Storage
unconfigured: provider URLs persist as today, `durableAssetUrl` stays null, publish stays
loud-blocked (`CREATIVE_ASSET_NOT_DURABLE`), and review playback lives on borrowed time
(provider CDN expiry); storage configured but upload throws: propagate (Inngest retry +
onFailure), never a fake success. Both behaviors copy the polished PR-A fail model verbatim.

This folds the known "UGC durable-asset storage" deferral in because reachability without it
breaks the loop invariant: an operator could generate and keep a UGC creative that can never be
published and whose review URL rots. Multi-asset selection for publish (a UGC job can produce
several assets) is v1-resolved as first-non-rejected; richer selection is post-slice backlog.

### 3.4 UGC mode reachable, surface second (the Mira desk learns the second format)

A separate, smaller PR once the engine PR is merged:

- `MiraBriefRequestSchema` gains `mode: z.enum(["polished", "ugc"]).default("polished")` (wire
  name matches `SubmitBriefInput.mode`). `mapMiraBriefToCreativeBrief` is unchanged (the brief
  shape is mode-agnostic; the submit workflow's ugc branch, fixed in 3.3d, owns the
  `UgcConfig` construction).
- `mira-brief.ts` threads `mode: brief.mode` into the ingress parameters (the one hardcode
  falls). The dashboard proxy already parses the shared schema; the brief box gains a two-option
  format toggle (product copy: "Polished" / "Real-talk", default Polished), posted as `mode`.
- **The pre-video gates get a navigation path.** The detail page ALREADY renders Continue/Stop
  for any `awaiting_review` job (read-model `reviewAction.canContinue`, video not required);
  what is missing is the way there. The in-production tray items become links to
  `/mira/creatives/<id>` with a "waiting for your go-ahead" state when the job is
  `awaiting_review`, and the detail page gets a no-video header treatment (phase progress +
  what Mira finished) plus the UGC cost-confirm rendering (single estimate, tier picker
  suppressed). This closes the same gap for POLISHED briefs (their four pre-video stage gates
  have the identical tray-invisible problem today, masked by demo seeds). Operator cost is
  stated honestly: a trust-0 UGC job takes four approve round-trips (planning, scripting which
  carries the spend park, production, delivery), the same weight as polished's four stage
  gates; threshold tuning is a named follow-on, not smuggled into this slice (raising trust
  would also silently bypass the spend gate, which rides the scripting approve).
- **UGC taste vocabulary.** Three coupled edit points, enumerated because the key is built in
  the sweep, not the descriptor: (1) `extractCreativeDescriptor` returns
  `{ mode, hookType, structureId? }`, reading the leading spec's `structureId` from
  ugc outputs passed by the caller; (2) the taste sweep passes mode-correct outputs
  (`job.ugcPhaseOutputs` for ugc) and builds the third canonicalKey segment from
  `structureId ?? hookType` for ugc (`taste:kept_ugc_demo_first`; fallback stays `none`);
  (3) `bucketContent` extends to render the structure vocabulary ("Operator kept ugc creatives
  with demo_first structure"), staying a pure function of the bucket (dedup axis preserved).
  The structure ids (confession, demo_first, myth_buster, ...) are bounded by the
  structure-engine template table and snake_case-conformant to `CANONICAL_KEY_PATTERN`.
  Polished extraction is pinned byte-identical by the existing tests. The
  `buildPerformanceHistory` call site gets the same mode-correct outputs in this PR (its UGC
  descriptors otherwise read `ugc:none` forever). Honest framing of the window: UGC gestures
  made between the engine PR and this PR write `taste:kept_ugc_none` buckets via the old
  descriptor; those are valid coarse observations that simply stay (memories record history;
  nothing migrates), and the structure-keyed buckets accumulate from this PR on.

Slice-2's measured-history enrichment needs no change (it runs at submit before the mode
branch). The taste PROVIDER stays polished-only in slice 3: injecting taste lines into the UGC
scripting prompt before UGC taste buckets exist would be feeding the model an empty block;
the wiring point (`runUgcScriptWriter`'s constraints) is named for the follow-on.

### 3.5 Real avatar UGC: implement the HeyGen seam, route organically

**The client.** `stages/heygen-client.ts` becomes a real submit-and-poll client, structurally
mirroring `KlingClient` (timeouts, transient-status retries, poll interval): create via HeyGen's
v2 generate endpoint (avatar character + voice input + dimension from aspect ratio), poll the
status endpoint until `completed`, return `{videoUrl, duration}`. New env `HEYGEN_API_KEY`
(allowlist `required_in_env_example` + `.env.example`, same PR; the key is read in bootstrap and
the client injected, so the env var IS visible to `check-env-completeness`'s apps-only scan).
API version pinning and the exact field names are implementation-time details verified against
HeyGen's current docs; the spec binds the SHAPE (submit/poll, avatar id + voice id in, video URL
out), not the field spelling.

**Identity.** The avatar id lives in the existing `identityRefIds` as a provider-prefixed
convention: `heygen:<avatar_id>` (no migration; a parse helper with tests;
the convention is documented on the schema field). Voice: a pinned default HeyGen voice id
(constant in the client). `VoiceSchema.provider` is `z.literal("elevenlabs")` today, so the
creator's voice block cannot describe a HeyGen voice without a schema change; widening that
enum belongs to the deferred lipsync upgrade, not v1. v1 speech is HeyGen-native TTS (text
mode). ElevenLabs-audio lipsync (synthesize locally, upload durable audio, pass audio_url) is
explicitly deferred: it requires durable audio upload first (the named R2 TODO at
`elevenlabs-client.ts:53`), and v1 needs one provider doing the whole job before composing two.

**Data flow.** Scripting (where creator objects are in hand) attaches
`spec.creator = { heygenAvatarId?, heygenVoiceId? }` from the cast creator, and computes
`providersAllowed` capability-aware: `["kling"]` plus `"heygen"` when the creator carries a
heygen ref AND the format is `talking_head` (HeyGen renders speaking avatars, not lifestyle
b-roll). Production passes the creator block through `VideoGenerationRequest` (new optional
`avatar` field); the HeyGen adapter throws a typed error when the block is absent (caught by the
existing retry/fallback loop, falling to Kling). Routing needs NO new infrastructure: with the
adapter real and `providersAllowed` honored (3.2), `rankProviders` already prefers HeyGen for
talking-head specs whose creator has an avatar (its `supportsAudioDrivenTalkingHead` bonus), and
the existing per-provider fallback covers HeyGen outages.

**Cost, same PR (the producer rule).** `estimateUgcCost` gains a provider-aware leg: per spec,
the MAX per-clip cost across its allowed providers (conservative parking; HeyGen per-clip
constant pinned in cost-estimator with a source comment, order $1/clip at current API pricing).
The router's internal `ESTIMATED_COST` table is aligned to the same constants (it only ranks,
but drift between the two tables would be a lie waiting to be read). The governance spend signal
and estimate readback update automatically through the 3.3 single source.

**Frame-QA applies unchanged** (provider-agnostic: it operates on the produced video file).
`faceSimilarity` becomes meaningful for avatar output once a reference resolver exists; v1
leaves it undefined (3.1).

**Rejected: fal.ai routing layer and Veo 3.1 Fast in v1.** The roadmap prioritizes avatar work
"by what the slice-2 loop shows actually moves performance"; no attributed data exists yet
(attribution is dark behind its kill-switch). One real avatar provider through the existing
seams is the smallest thing that makes avatar UGC true; the trigger for a second provider or a
routing aggregator is recorded: measured avatar-UGC outperformance, or HeyGen reliability
forcing a fallback. Seedance/Runway stay throwing stubs at `apiMaturity: "low"` (never ranked).

**Rejected: a typed avatar-refs schema field now.** A migration for one provider is premature;
the prefixed-ref convention is reversible and a second provider, if it ever lands, motivates the
typed shape with real requirements.

### 3.6 The whisper-key truth fix (smallest PR, ships first)

`StageInput` gains `openaiApiKey?: string`, threaded from the runner's existing `imageConfig`
(bootstrap already reads `OPENAI_API_KEY`). `run-stage` constructs `WhisperClient` with it, and
only when present (mirroring the image-generator skip); absent key means no whisper call and an
honest captions degrade instead of a guaranteed 401. Co-located test: pro tier without the
OpenAI key constructs no whisper client; with it, the whisper client receives THAT key. No env,
no schema, no behavior change beyond captions starting to actually work where configured.

## 4. PR plan (six focused branches off main, strict order, no stacking)

| PR | Title | Content | Live consumer in-PR |
| --- | --- | --- | --- |
| 0 | `fix(creative-pipeline): pro-tier captions use the OpenAI key` | 3.6 | The pro-tier production stage (existing) |
| 1 | `feat(creative-pipeline,core,dashboard): real frame-QA on UGC assets` | 3.1: FrameExtractor, `callClaudeWithImages`, real `evaluateRealism` with deps injection + honest degrade, renormalized soft score, production retry-on-fail + attempt-accurate budget, read-model `qa` projection (core status-mapper) + desk detail line | Production gating + the desk QA line |
| 2 | `feat(creative-pipeline): UGC prompts honor SceneStyle/UgcDirection` | 3.2: `buildUgcVideoRequest`, production threads style/direction/negative/camera/reference-by-format, `providersAllowed` honored | Production generate calls |
| 3a | `feat(api,creative-pipeline,db,schemas): UGC pipeline reachable end to end` | 3.3: jobId-only approval resume, mode-aware guard (incl. `ugcFailure`), valid `UgcConfig` construction at submit, `estimateUgcCost` + spend producer gated on `ugcPhase === "production"` + estimate readback + router cost alignment, seeded default creator + defensive `generateDirection`, durable UGC assets (`AssetOutputsSchema.sourceUrl` additive, bootstrap `assetStorage` injection) + `durableAssetUrl`, all-rejected-reads-failed status rule | The existing governed `/creative-jobs` route, proven by the loop-closing test |
| 3b | `feat(api,dashboard,schemas,creative-pipeline): UGC briefs from the Mira desk` | 3.4: `MiraBriefRequestSchema.mode`, route threading, brief-box toggle, in-production tray links + no-video detail treatment (closes the polished gap too), UGC cost-confirm rendering (single estimate, no tier picker), structure-aware UGC taste descriptor (three edit points incl. `buildPerformanceHistory`) | Operators on /mira; the taste sweep |
| 4 | `feat(creative-pipeline,api): real HeyGen avatar provider` | 3.5: real client, adapter + `VideoGenerationRequest.avatar`, scripting creator refs + capability-aware `providersAllowed`, provider-aware costs, `HEYGEN_API_KEY` | Talking-head UGC specs with avatar-bearing creators |

Sequencing rationale: 0 is independent truth; 1 and 2 harden quality on the pipeline BEFORE it
becomes operator-reachable (3a/3b); 4 rides on 2's request plumbing + 3a's reachability. PRs 1,
2, and 3a all edit `processSpec` / `executeProductionPhase`, so they execute strictly serially:
each branches from the merged tip of its predecessor (this is serial execution, not a GitHub
stack; each PR opens only after the previous one squash-merges). Each PR passes the full gate
set (typecheck, build, lint, format, arch, touched suites + full apps/api, check-routes,
env-completeness, db drift where schema changes) and two adversarial reviews. Files touched
along the way get their stale `packages/core/...` path header comments corrected
opportunistically (pre-existing cruft in the ugc modules).

Migrations: none anticipated (no Prisma schema change in any PR; `sourceUrl` is a zod-level
optional on a JSON column shape; the seeded creator uses existing tables). If implementation
surfaces a needed migration it lands in the same commit per house rules.

## 5. Invariants held (cross-cutting, from the roadmap)

1. **Existing spine only.** No new orchestration; all new work is inside existing Inngest
   functions and pure L2 modules. Submission, approval, and spend stay on
   `PlatformIngress.submit()` exactly as wired today; the publish path is byte-untouched.
2. **Frame-QA gates integrity, not taste** (the under-0.35 rule). The prompt is pinned to
   objective checks; `audioNaturalness` is never fabricated from frames; aesthetic judgment
   remains the operator's Keep/Pass and the human approval gates.
3. **Honest-stub discipline.** Every QA infrastructure shortfall returns
   `requires_human_review`; `evaluated` appears ONLY when real frames went through a real vision
   call. `deriveApprovalState` and `evaluateMinimalQa` are untouched.
4. **Paused-only publish; activation unreachable; claim review human-gated at every tier.** No
   autonomy surface changes. UGC keeps every human gate polished has (phase approvals at low
   trust, Keep/Pass, mandatory publish approval). `updateCampaignStatus("ACTIVE")` still throws.
5. **Nothing built-but-unwired; producers ship with consumers.** Frame-QA ships with its gating
   and desk consumers (PR-1); the spend producer ships in the reachability PR with a
   real-producer governance test (PR-3a); the descriptor vocabulary ships when UGC gestures
   start flowing (PR-3b); avatar costs ship with the avatar provider (PR-4).
6. **The `mira-decision` route stays byte-untouched**, as do the two-shapes-one-column
   `pastPerformance` firewall and `revenue_proven` (Riley-owned vocabulary, zero writers).

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Vision QA false-fails burn render budget via retries | Bounded by existing retry/fallback caps + the attempt-accurate budget accumulator; a `fail` requires a hard-check breach (critical artifact), not a soft score; soft weakness routes to `review` (human), not retry |
| Kling CDN host missing from `CREATIVE_PIPELINE_ALLOWED_HOSTS` in a deployed env | QA degrades to `requires_human_review` and production proceeds (honest degrade); runbook note pins the host; the same policy already gates pro-tier assembly downloads, so a misconfig is already visible today |
| jobId-only approval matching resumes a wait the operator did not mean | Identical to the polished contract in production for months; waits are sequential per job; approve is org-scoped + governed; the phase payload stays in the event for audit |
| Seeded default creator surprises operators ("who is this person?") | Synthetic persona, clearly named (e.g. "House Creator"), stock tier, no real-person likeness; UGC drafts pass the same human review as everything else |
| HeyGen API drift vs the spec's shape assumptions | The spec binds submit/poll shape only; the client pins the API version, mirrors KlingClient's retry/timeout posture, and any 4xx surfaces as a generation error that falls back to Kling |
| UGC spend estimate understates retry tails | Documented division of labor: governance parks expected (1x) spend; `totalJobBudget` + attempt accounting bound the tail inside production |
| Renormalized soft score changes existing verdicts | An explicit, stated contract change for partial inputs (the `handles partial scores` unit test updates with it, 3.1); full-set scores are arithmetically identical; the safety gate is `deriveApprovalState`'s `qaStatus` check, untouched |
| Structure-aware taste keys split historical buckets | Additive keys only; `_ugc_none` rows remain valid history; content stays a pure function of the bucket (dedup axis preserved) |
| Two cost tables drift (cost-estimator vs provider-router) | PR-4 aligns them to shared constants and adds a parity test |

## 7. What flips it live

- PR-0/1/2 are live at merge for every UGC job (and PR-0 for polished pro-tier): no flags. QA
  evaluates when ffmpeg + allowlist + API key are present; otherwise honest degrade.
- PR-3a makes `mode: "ugc"` real for the governed API route; PR-3b puts the toggle in front of
  operators. No kill-switch: every step already sits behind human approval gates (low-trust
  phase approvals + spend threshold + Keep/Pass + mandatory publish approval), and generation
  spend is parked by the same #788 lever polished uses.
- PR-4 activates when `HEYGEN_API_KEY` is configured AND a creator carries a `heygen:` ref;
  absent either, routing never selects HeyGen (capability-aware `providersAllowed`).
- Slice-2 interactions stay dark/dormant exactly as shipped: attribution remains behind
  `CREATIVE_ATTRIBUTION_ENABLED`; UGC creatives that publish join attribution identically to
  polished (campaign-level join, mode-agnostic).

## 8. Out of scope (deferred deliberately, with named seams)

- Polished-pipeline frame-QA badge (same evaluator, assembly-time; mechanical once wanted).
- ElevenLabs-audio lipsync for HeyGen (needs durable audio upload; seam at
  `elevenlabs-client.ts:53`).
- fal.ai / Veo 3.1 / Seedance / Runway activation (trigger: measured avatar outperformance or
  provider reliability pressure).
- Operator creator-management UI (CRUD for creator personas/avatars); post-slice backlog.
- Taste-provider injection into UGC scripting prompts (wiring point:
  `runUgcScriptWriter` constraints; trigger: UGC taste buckets exist with real source counts).
- Multi-asset publish selection for UGC jobs (v1: first non-rejected asset).
- `creatorReferenceUrl` resolution for `faceSimilarity` (needs an asset-id resolver).
- Mira's brain (SKILL.md, builder, governed executor, self-initiated briefs): slice 4, last.
