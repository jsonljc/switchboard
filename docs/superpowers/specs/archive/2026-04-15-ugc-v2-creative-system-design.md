# UGC System v2 — Design Spec

**Date:** 2026-04-15
**Status:** Draft
**Family:** Family 2 — Creative & Revenue
**Extends:** Performance Creative Director (PCD)

---

## 1. Overview

UGC v2 is a parallel creative pipeline inside Switchboard that generates brand-safe, consistent AI creators, routes them through backend-appropriate identity strategies, scores outputs for realism and consistency, and closes the loop with business and funnel outcomes.

### What It Does

Switchboard is not "the video model." It is the operating system that decides:

- Which creator should exist
- Which ad structure to use
- Which backend should generate
- Whether the output is believable enough
- Whether the creative actually solved a funnel problem

### Core Principle

UGC v2 extends the existing PCD polished pipeline from:

- Structure selection → script writing → storyboard → production

Into a full UGC-native system with:

- Creator identity management
- Identity strategy routing
- Provider routing by capability
- Realism gating and QA
- Funnel-aware creative feedback

### System Goals

**Primary:**

- Produce UGC creatives that feel native to Meta, TikTok, and Reels
- Maintain creator identity consistency across repeated generations
- Preserve acceptable continuity across multi-shot outputs
- Select only the few creatives most likely to get meaningful delivery
- Learn from performance at structure, creator, and funnel-friction level

**Secondary:**

- Keep backend choice pluggable
- Avoid vendor lock-in
- Reuse approved assets when exact reproduction is needed
- Support future fine-tuned identity systems

### Non-Goals

- Perfect pixel-identical regeneration across runs (exact repetition comes from locked asset reuse, not fresh generation)
- Building a proprietary video foundation model
- Replacing the polished pipeline
- Full autonomous publishing without approval controls

---

## 2. Architecture

### 2.1 Parallel Pipeline

UGC v2 runs alongside the existing polished pipeline. Both share a common infrastructure layer but have independent orchestration, stage definitions, state shapes, and approval models.

```
creative-pipeline/job.submitted
        ↓
  mode-dispatcher
   ├── creative-job-runner   (polished — existing)
   └── ugc-job-runner        (UGC — new)

Shared core:
  call-claude, kling-client, heygen-client, elevenlabs-client,
  whisper-client, video-assembler, image-generator,
  creative-job-store, inngest-client, cost-estimator
```

**Why parallel, not branched:** UGC mode has different stage order, state shape, failure modes, routing logic, asset dependencies, QA requirements, and feedback model. Stuffing that into one conditional mega-runner creates debugging misery.

**Shared core rule:** Shared core contains only infra, adapters, and utilities. No business logic. UGC-specific logic stays in `ugc/`.

### 2.2 Mode Dispatcher

A thin Inngest function that reads `mode` from the job event and dispatches to the correct runner. No logic, no transformation, just routing.

**Migration requirement (SP2):** The existing `creative-job-runner` currently triggers on `creative-pipeline/job.submitted`. SP2 must change its trigger to `creative-pipeline/polished.submitted` and update `CreativePipelineEvents` in `inngest-client.ts` to include the new event types. The mode dispatcher takes over `job.submitted` as the single entry point. This is a breaking change to the existing pipeline and must be coordinated.

```typescript
// creative-pipeline/mode-dispatcher.ts
inngestClient.createFunction(
  { id: "creative-mode-dispatcher", triggers: [{ event: "creative-pipeline/job.submitted" }] },
  async ({ event, step }) => {
    const mode = event.data.mode ?? "polished";
    if (mode === "ugc") {
      await step.sendEvent("dispatch-ugc", {
        name: "creative-pipeline/ugc.submitted",
        data: { ...event.data, mode: "ugc", pipelineVersion: "ugc_v2", dispatchedAt: new Date() },
      });
    } else {
      await step.sendEvent("dispatch-polished", {
        name: "creative-pipeline/polished.submitted",
        data: { ...event.data, mode: "polished", dispatchedAt: new Date() },
      });
    }
  },
);
```

### 2.3 UGC Pipeline Phases

Stages are grouped into logical phases. Approval gates sit between phases, not substages.

```
Phase 1: Planning       → structure selection, scene casting, identity routing
Phase 2: Scripting      → UGC script writing, UGC direction
Phase 3: Production     → provider routing, generation, realism QA, retry/fallback
Phase 4: Delivery       → approval gate, publish + track, funnel feedback writeback
```

Phase 3 runs its retry/fallback loop internally without buyer involvement. Phase 4's approval gate is trust-level-aware.

### 2.4 Three Clean Layers

```
Layer 1 — Orchestration:   mode-dispatcher, job runners, phase sequencing
Layer 2 — Decision Systems: structure engine, identity router, provider router, funnel translator
Layer 3 — Execution:        providers (Kling, HeyGen), Claude, ElevenLabs, QA tools
```

### 2.5 File Structure

```
packages/core/src/creative-pipeline/
  mode-dispatcher.ts              — thin dispatch
  creative-job-runner.ts          — existing polished runner (retrigger only)
  ugc/
    ugc-job-runner.ts             — phase orchestration
    phases/
      planning.ts                 — structure + casting + identity
      scripting.ts                — script + direction
      production.ts               — provider routing + gen + QA + retry
      delivery.ts                 — approve + publish + feedback
    identity-strategy-router.ts
    provider-router.ts
    realism-scorer.ts
    funnel-friction-translator.ts
    structure-engine.ts
    scene-caster.ts
    ugc-script-writer.ts
    ugc-director.ts
  stages/                         — shared primitives (existing)
    call-claude.ts, kling-client.ts, elevenlabs-client.ts, ...
```

Dependency direction (each package may only import from packages above it):

```
packages/schemas       → no internal deps
packages/cartridge-sdk → schemas
packages/core          → schemas, cartridge-sdk (defines store interfaces only)
packages/db            → schemas, core (implements store interfaces)
apps/*                 → may import anything (wires concrete deps into runners)
```

---

## 3. Data Model

### 3.1 CreativeJob Extension

Extends the existing `CreativeJob` model rather than creating a parallel one. The polished pipeline already links to `AgentTask` for governance/trust.

```prisma
model CreativeJob {
  // ... existing fields ...

  mode                    String    @default("polished")  // "polished" | "ugc"

  // UGC-specific (nullable, only populated when mode = "ugc")
  ugcPhase                String?   // "planning" | "scripting" | "production" | "delivery" | "complete"
  ugcPhaseOutputs         Json?     // { planning: PlanningOutput, scripting: ScriptingOutput, ... }
  ugcPhaseOutputsVersion  String?   @default("v1")  // enables schema migration
  ugcConfig               Json?     // UGC-specific job configuration
}
```

**State shape:** Polished uses `currentStage` + `stageOutputs`. UGC uses `ugcPhase` + `ugcPhaseOutputs`. No ambiguity.

**Mode invariant (enforced at store level):**

- Polished jobs (`mode === "polished"`) must never write `ugcPhase` or `ugcPhaseOutputs`
- UGC jobs (`mode === "ugc"`) must never write `currentStage` or `stageOutputs` after mode dispatch
- The store methods enforce this: `UgcJobStore.updateUgcPhase()` rejects calls where `job.mode !== "ugc"`, and the existing `updateStage()` rejects calls where `job.mode !== "polished"`

**SP1 migration note:** SP1 must also update `CreativeJobSchema` in `packages/schemas/src/creative-job.ts` to add the `mode` field, and update the API route in `apps/api/src/routes/creative-pipeline.ts` to accept and validate `mode` on job submission.

### 3.2 CreatorIdentity (New)

```prisma
model CreatorIdentity {
  id                  String   @id @default(cuid())
  deploymentId        String
  name                String

  // Identity anchors (asset IDs, not raw URLs)
  identityRefIds      String[]          // AssetRecord IDs for canonical references
  heroImageAssetId    String
  identityDescription String

  // Provider-specific identity objects
  identityObjects     Json?             // { klingCharacterId?, heygenAvatarId?, ... }

  // Voice
  voice               Json              // { voiceId, provider, tone, pace, sampleUrl, settings? }

  // Personality
  personality         Json              // { energy, deliveryStyle, catchphrases?, forbiddenPhrases? }

  // Appearance rules
  appearanceRules     Json              // { hairStates, wardrobePalette, jewelryRules?, ... }

  // Environment
  environmentSet      String[]

  // State
  approved            Boolean  @default(false)
  isActive            Boolean  @default(true)
  bibleVersion        String   @default("1.0")
  previousVersionId   String?            // for rollback + A/B testing

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // Relations
  assets              AssetRecord[]

  @@index([deploymentId])
}
```

**Why JSON for voice/personality/appearance:** Structured but variable-shape objects validated via Zod at runtime. Consistent with existing codebase pattern (`stageOutputs`, `pastPerformance`).

**Identity reference note:** `identityRefIds` and `heroImageAssetId` are logical references to `AssetRecord` IDs, not Prisma relations. These are validated at the application layer. Asset deletion must cascade through a service method that checks and updates `CreatorIdentity` references — not via Prisma cascade.

### 3.3 AssetRecord (New)

```prisma
model AssetRecord {
  id                  String   @id @default(cuid())
  jobId               String               // links to the CreativeJob that spawned this
  job                 CreativeJob @relation(fields: [jobId], references: [id])
  specId              String               // logical ref into ugcPhaseOutputs.scripting.specs[].specId (cuid, assigned during scripting phase)
  creatorId           String?
  creator             CreatorIdentity? @relation(fields: [creatorId], references: [id])

  // Generation metadata
  provider            String               // "kling" | "heygen" | future providers
  modelId             String
  modelVersion        String?
  seed                Int?

  // Input hashes (for reproducibility tracking)
  inputHashes         Json                 // { referencesHash, promptHash, audioHash? }

  // Outputs
  outputs             Json                 // { videoUrl?, imageUrl?, audioUrl?, checksums }

  // QA results
  qaMetrics           Json?                // RealismScore
  qaHistory           Json?                // Array<{ attempt, provider, score }> — full attempt history

  // Identity tracking
  identityDriftScore  Float?
  baselineAssetId     String?              // canonical identity ref this was compared against

  // Provider execution metadata
  latencyMs           Int?
  costEstimate        Float?
  attemptNumber       Int?

  // Approval
  approvalState       String   @default("pending")  // "pending" | "approved" | "rejected" | "locked"
  lockedDerivativeOf  String?              // assetId of the original if this is a locked reuse

  createdAt           DateTime @default(now())

  @@index([jobId])
  @@index([specId])
  @@index([creatorId])
  @@index([approvalState])
}
```

### 3.4 Zod Schemas

New schema files in `packages/schemas/src/`, all Layer 1 (no internal deps):

| File                       | Contents                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| `ugc-job.ts`               | UGC phase enums, phase output schemas, UGC config schema, CreativeSpec schema |
| `creator-identity.ts`      | CreatorIdentity schema with typed voice, personality, appearance sub-schemas  |
| `asset-record.ts`          | AssetRecord schema, input hash schema, QA metrics schema                      |
| `identity-strategy.ts`     | Strategy enum, IdentityPlan schema                                            |
| `provider-capabilities.ts` | ProviderCapabilityProfile schema, ProviderRole enum                           |
| `realism-score.ts`         | RealismScore with `hardChecks` + `softScores` + `overallDecision`             |
| `funnel-friction.ts`       | FunnelFriction schema, FrictionType enum, consumer-side read interface        |

### 3.5 Phase Contracts

Each phase has typed input/output for testability, replay, and debugging.

```typescript
// Planning
interface UgcBrief extends CreativeBriefInput {
  // UGC-specific extensions to the existing CreativeBriefInput
  creatorPoolIds: string[]; // which creators to consider
  ugcFormat: "talking_head" | "lifestyle" | "product_in_hand" | "multi_shot";
  imperfectionProfile?: ImperfectionProfile;
}

interface PlanningInput {
  brief: UgcBrief;
  creatorPool: CreatorIdentity[];
  performanceMemory: PerformanceMemory;
  funnelFrictions: FunnelFriction[];
  providerCapabilities: ProviderCapabilityProfile[];
}
interface PlanningOutput {
  structures: StructureSelection[];
  castingAssignments: CastingAssignment[]; // references creatorId + structureId pairs, not specIds
  identityPlans: IdentityPlan[];
}
// Note: CastingAssignment identifies creator × structure pairs. SpecIds are minted in the
// scripting phase when a CastingAssignment becomes a fully-formed CreativeSpec. The mapping
// is 1:1 but the identity is only assigned when the spec materializes.

// Scripting
interface ScriptingInput {
  planningOutput: PlanningOutput;
  brief: UgcBrief;
  creatorPool: CreatorIdentity[];
}
interface ScriptingOutput {
  specs: CreativeSpec[]; // fully formed specs ready for production
}

// Production
interface ProductionInput {
  specs: CreativeSpec[];
  providerCapabilities: ProviderCapabilityProfile[];
  retryConfig: { maxAttempts: number; maxProviderFallbacks: number };
}
interface ProductionOutput {
  assets: AssetRecord[];
  qaResults: Record<string, RealismScore[]>; // specId → attempt history
  failedSpecs: Array<{ specId: string; reason: string }>;
}

// Delivery
interface DeliveryInput {
  assets: AssetRecord[];
  qaResults: Record<string, RealismScore[]>;
  approvalConfig: ApprovalConfig;
  funnelFrictions: FunnelFriction[];
}
interface DeliveryOutput {
  publishedAssets: AssetRecord[];
  feedbackWritten: boolean;
}
```

**Stub types for early sub-projects:**

`PerformanceMemory` and `ProviderPerformanceHistory` are not implemented until SP7/SP8. Until then, they are empty stubs that the pipeline handles gracefully:

```typescript
// Stub — SP3 ships with this, SP8 replaces it
interface PerformanceMemory {
  structureHistory: Record<string, StructurePerformanceRecord>; // structureId → record
  creatorHistory: Record<string, CreatorPerformanceRecord>; // creatorId → record
}
// Empty performance memory = no historical influence, pure affinity-based selection

// Stub — SP5 ships with this, SP7 replaces it
interface ProviderPerformanceHistory {
  passRateByProvider: Record<string, number>; // provider → pass rate
  avgLatencyByProvider: Record<string, number>; // provider → avg ms
  costByProvider: Record<string, number>; // provider → avg cost
}
// Empty history = capability-only ranking, no historical weighting
```

---

## 4. Subsystems

### 4.1 Structure Engine

Ad arc template library with weighted selection.

```typescript
type StructureId =
  | "confession"
  | "mistake"
  | "social_proof"
  | "pas"
  | "demo_first"
  | "before_after"
  | "comparison"
  | "myth_buster";

interface StructureTemplate {
  id: StructureId;
  name: string;
  sections: Array<{ name: string; purposeGuide: string; durationRange: [number, number] }>;
  platformAffinity: Record<string, number>; // platform → score
  funnelFrictionAffinity: Record<string, number>; // frictionType → score
}
```

Selection weighted by:

- Platform affinity (structure × platform fit)
- Funnel friction affinity (structure × active friction match)
- Performance memory (historical CTR/hold rate per structure)
- Fatigue penalty (recent overuse of same structure)

All weights normalized before combining:

```
normalizedScore =
  w1 * normalize(platformScore) +
  w2 * normalize(frictionScore) +
  w3 * normalize(performanceScore) -
  w4 * normalize(fatiguePenalty)
```

Weights are configurable and should be calibrated over time by logging decisions and comparing against outcomes.

### 4.2 Scene Caster

Scores and assigns creators to structures.

```typescript
interface CastingScore {
  creatorId: string;
  structureId: string;
  total: number;
  breakdown: {
    structureCreatorAffinity: number;
    platformPerformance: number;
    funnelProblemFit: number;
    creatorStructurePerformance: number; // historical per creator × structure
    creatorHookPerformance: number; // historical per creator × hook type
    fatiguePenalty: number;
    repetitionPenalty: number;
    creatorFatigueDecay: number; // audience fatigue for this creator
  };
}
```

### 4.3 Identity Strategy Router

Decides **how** identity is enforced per casting assignment.

```typescript
type IdentityStrategy =
  | "platform_identity" // provider's native identity object
  | "reference_conditioning" // reference images / first-frame
  | "fine_tuned_identity" // LoRA / DreamBooth (future)
  | "asset_reuse"; // locked reuse of approved asset

interface IdentityPlan {
  creatorId: string;
  primaryStrategy: IdentityStrategy;
  fallbackChain: IdentityStrategy[]; // ordered fallbacks, not just one
  constraints: {
    maxIdentityDrift: number;
    lockHairState: boolean;
    lockWardrobe: boolean;
    requireExactReuse: boolean;
  };
}
```

**Decision logic:**

```
if requireExactReuse              → asset_reuse
if creator.isPremium && mature    → fine_tuned_identity (if supported)
if provider.identityStrength=high → platform_identity
else                              → reference_conditioning
```

**Phase 1 reality:** Only `reference_conditioning` and `asset_reuse` are implemented. `platform_identity` activates when Kling ships character/identity APIs. `fine_tuned_identity` is Phase 4.

### 4.4 Provider Router

Classifies and ranks providers by role and capability fit.

```typescript
type ProviderRole = "production" | "narrow_use" | "planned" | "tooling";

interface ProviderCapabilityProfile {
  provider: string;
  role: ProviderRole;

  // Capabilities
  identityStrength: "high" | "medium" | "low";
  supportsIdentityObject: boolean;
  supportsReferenceImages: boolean;
  supportsFirstLastFrame: boolean;
  supportsExtension: boolean;
  supportsMotionTransfer: boolean;
  supportsMultiShot: boolean;
  supportsAudioDrivenTalkingHead: boolean;
  supportsProductTextIntegrity: boolean;

  // Operational
  apiMaturity: "high" | "medium" | "low";
  seedSupport: boolean;
  versionPinning: boolean;
}
```

**Phase 1 provider registry:**

| Provider   | Role       | Notes                                              |
| ---------- | ---------- | -------------------------------------------------- |
| Kling      | production | Primary backend, image2video + text2video          |
| HeyGen     | narrow_use | Talking-head/avatar only, if integration is usable |
| Seedance   | planned    | Reference-to-video, first/last frame, extension    |
| Runway     | planned    | Developer ergonomics, seeds, image constraints     |
| Higgsfield | tooling    | Workflow/prototyping only, not runtime             |

**Ranking function:**

```typescript
function rankProviders(
  spec: CreativeSpec,
  registry: ProviderCapabilityProfile[],
  history: ProviderPerformanceHistory,
): RankedProvider[];
```

Scores by: identity fit, format support, historical pass rate for this creator/format, cost, latency. Only `production` and `narrow_use` providers with `apiMaturity !== "low"` are eligible for runtime ranking.

### 4.5 Realism Scorer

Hybrid architecture — target design is specialized hard checks + Claude Vision soft scores. Rollout starts with Claude Vision for everything, specialized models added incrementally.

```typescript
interface RealismScore {
  hardChecks: {
    faceSimilarity?: number; // cosine similarity vs identity refs
    ocrAccuracy?: number; // product/logo text integrity
    voiceSimilarity?: number; // voice embedding match (Phase 2+)
    lipSyncScore?: number; // SyncNet or equivalent (Phase 3+)
    artifactFlags: string[]; // "face_drift" | "hand_warp" | "product_warp" | ...
  };
  softScores: {
    visualRealism?: number; // skin, lighting, camera feel
    behavioralRealism?: number; // blink, mouth, head motion
    ugcAuthenticity?: number; // native vs too-polished
    audioNaturalness?: number; // breath, pauses, room tone
  };
  overallDecision: "pass" | "review" | "fail";
}
```

**Decision logic:**

```
if faceSimilarity < threshold           → fail
if ocrAccuracy < threshold              → fail
if artifactFlags contains critical      → fail
if weightedSoftScore < threshold        → review (human QA)
else                                    → pass
```

Soft score weighting (UGC authenticity weighs highest):

```
weightedSoftScore =
  0.20 * visualRealism +
  0.20 * behavioralRealism +
  0.35 * ugcAuthenticity +
  0.25 * audioNaturalness
```

**Implementation by phase:**

| Field            | Phase 1                      | Phase 2+                   |
| ---------------- | ---------------------------- | -------------------------- |
| faceSimilarity   | Claude Vision comparison     | ArcFace/FaceNet embeddings |
| ocrAccuracy      | Claude Vision OCR check      | Dedicated OCR              |
| voiceSimilarity  | —                            | Voice embedding comparison |
| lipSyncScore     | —                            | SyncNet or equivalent      |
| artifactFlags    | Claude Vision                | Dedicated classifiers      |
| softScores (all) | Claude Vision prompt scoring | Claude Vision (stays)      |

### 4.6 Funnel Friction Translator

Consumes `FunnelFriction[]` and produces creative decision weights. Does not own ingestion — that is a separate cross-system spec.

```typescript
interface FunnelFriction {
  id: string;
  deploymentId: string;
  frictionType: FrictionType;
  source: "crm" | "chat" | "sales_agent" | "ads" | "call_review" | "manual";
  confidence: "low" | "medium" | "high";
  evidenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt?: Date;
  notes?: string[];
  metadata?: Record<string, string | number | boolean>;
}

interface FunnelFrictionStore {
  /** Returns only non-expired, non-decayed frictions. Applies freshness policy internally:
   *  - Excludes frictions past expiresAt
   *  - Excludes low-confidence frictions with lastSeenAt > 7 days ago
   *  - Excludes high-confidence frictions with lastSeenAt > 30 days ago */
  getActiveFrictions(deploymentId: string): Promise<FunnelFriction[]>;
}

interface CreativeWeights {
  structurePriorities: Partial<Record<StructureId, number>>;
  motivatorPriorities: Record<string, number>;
  scriptConstraints: string[];
  hookDirectives: string[];
}

function translateFrictions(frictions: FunnelFriction[]): CreativeWeights;
```

**Translation rules:**

| Friction             | Structure Priority                     | Motivator Priority                  | Script Constraint                     |
| -------------------- | -------------------------------------- | ----------------------------------- | ------------------------------------- |
| low_trust            | social_proof, confession, before_after | —                                   | —                                     |
| price_shock          | —                                      | value, cost_of_inaction, comparison | —                                     |
| expectation_mismatch | demo_first, myth_buster                | —                                   | "set clear expectations early"        |
| weak_hook            | —                                      | —                                   | increase hook novelty                 |
| offer_confusion      | demo_first                             | clarity                             | "explicit offer breakdown"            |
| low_urgency          | —                                      | scarcity, fomo                      | "time-bound framing"                  |
| weak_demo            | demo_first, before_after               | —                                   | "show product in use within first 5s" |
| poor_social_proof    | social_proof                           | —                                   | "lead with testimonial or number"     |

**Conflict resolution:** When multiple frictions are active, prioritize by confidence (high > medium > low), cap active directives to prevent contradictory script constraints, and merge compatible priorities.

**Anti-overfitting guardrail:** Frictions influence weighting but never fully override creator/platform affinity unless confidence is `"high"` AND `evidenceCount >= 5`. This prevents the system from chasing noisy sales objections from a single bad call or a small CRM sample. Friction weight contribution is capped at 40% of the final normalized score — creator fit and platform fit always retain majority influence.

**Freshness policy:** Low confidence decays after 7 days without new evidence. High confidence persists up to 30 days. Expired frictions are excluded.

### 4.7 UGC Script Writer & Director

Separate files from polished pipeline equivalents, not conditional branches.

**Script Writer additions:**

- Filler density target (15-25% filler words for natural speech)
- Sentence fragmentation (short, incomplete thoughts)
- Allowed slang set per creator personality
- Forbidden ad-language phrases ("limited time offer", "act now")
- Creator bible voice constraints (catchphrases, forbidden phrases)
- Script constraints from funnel friction translation
- Imperfection injector: hesitation points, sentence restarts, micro pauses

**Director additions:**

- UGC-native camera direction (handheld, selfie angle, slightly off-center)
- Lighting direction (natural/ambient, not studio)
- Environment selection from creator's `environmentSet`
- Wardrobe/appearance enforcement from `appearanceRules`

---

## 5. UGC Job Runner & Orchestration

### 5.1 Runner Structure

```typescript
const PHASE_ORDER = ["planning", "scripting", "production", "delivery"] as const;
type UgcPhase = (typeof PHASE_ORDER)[number];

interface PhaseExecutionMeta {
  phase: UgcPhase;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  substagesCompleted: string[];
  resultSummary: Record<string, unknown>;
}

export async function executeUgcPipeline(
  eventData: UgcJobEventData,
  step: StepTools,
  deps: UgcPipelineDeps,
): Promise<void> {
  const job = await step.run("load-job", () => deps.jobStore.findById(eventData.jobId));
  if (!job) throw new Error(`UGC job not found: ${eventData.jobId}`);

  const context = await step.run("preload-context", () => preloadContext(job, deps));

  let phaseOutputs: Record<string, unknown> = (job.ugcPhaseOutputs ?? {}) as Record<
    string,
    unknown
  >;

  // Resume from last completed phase.
  // NOTE: This is a second layer of defense for function-level restarts (e.g., Inngest function
  // version upgrade or manual re-invocation). The primary retry mechanism is Inngest's step-level
  // checkpointing — if a step.run() fails, Inngest retries just that step, not the whole function.
  // This manual resume only matters when the entire function is re-invoked from scratch.
  const startPhase = job.ugcPhase ?? "planning";
  const startIdx = PHASE_ORDER.indexOf(startPhase as UgcPhase);

  for (let i = startIdx; i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i];

    const meta: PhaseExecutionMeta = {
      phase,
      startedAt: new Date(),
      substagesCompleted: [],
      resultSummary: {},
    };

    const output = await step.run(`phase-${phase}`, () =>
      executePhase(phase, { job, context, previousPhaseOutputs: phaseOutputs, deps, meta }),
    );

    meta.completedAt = new Date();
    meta.durationMs = meta.completedAt.getTime() - meta.startedAt.getTime();

    phaseOutputs = { ...phaseOutputs, [phase]: output, [`_meta_${phase}`]: meta };
    const nextPhase = getNextPhase(phase);

    await step.run(`save-${phase}`, () =>
      deps.jobStore.updateUgcPhase(job.id, nextPhase, phaseOutputs),
    );

    // Emit phase completion event
    await step.sendEvent(`emit-${phase}-complete`, {
      name: "creative-pipeline/ugc-phase.completed",
      data: {
        jobId: job.id,
        phase,
        durationMs: meta.durationMs,
        substagesCompleted: meta.substagesCompleted,
        resultSummary: meta.resultSummary,
      },
    });

    // Approval gate BEFORE checking for complete (so delivery phase gets gated too).
    // Match on BOTH jobId AND phase to prevent a stale approval event from a previous phase
    // from accidentally resuming the wrong checkpoint.
    if (
      shouldRequireApproval({
        phase,
        trustLevel: context.trustLevel,
        deploymentType: context.deploymentType,
      })
    ) {
      const approval = await step.waitForEvent(`wait-approval-${phase}`, {
        event: "creative-pipeline/ugc-phase.approved",
        timeout: "24h",
        match: "data.jobId",
        if: `async.data.phase == '${phase}'`,
      });

      if (!approval || approval.data.action === "stop") {
        await step.run(`stop-at-${phase}`, () => deps.jobStore.stopUgc(job.id, phase));
        return;
      }
    }

    if (nextPhase === "complete") break;
  }
}
```

### 5.2 Preload Context

Single upfront load of everything phases need.

```typescript
interface UgcPipelineContext {
  creatorPool: CreatorIdentity[];
  performanceMemory: PerformanceMemory;
  funnelFrictions: FunnelFriction[];
  providerRegistry: ProviderCapabilityProfile[];
  providerHistory: ProviderPerformanceHistory;
  trustLevel: number;
  deploymentType: string;
  structureTemplates: StructureTemplate[];
}

async function preloadContext(
  job: CreativeJob,
  deps: UgcPipelineDeps,
): Promise<UgcPipelineContext> {
  const [
    creatorPool,
    performanceMemory,
    funnelFrictions,
    providerRegistry,
    providerHistory,
    deployment,
  ] = await Promise.all([
    deps.creatorStore.findByDeployment(job.deploymentId),
    deps.performanceStore.getMemory(job.deploymentId),
    deps.frictionStore.getActiveFrictions(job.deploymentId),
    deps.providerRegistry.getAll(),
    deps.providerRegistry.getHistory(job.deploymentId),
    deps.deploymentStore.findById(job.deploymentId),
  ]);

  return {
    creatorPool,
    performanceMemory,
    funnelFrictions,
    providerRegistry: providerRegistry.filter(
      (p) => p.role === "production" || p.role === "narrow_use",
    ),
    providerHistory,
    // Trust level comes from the listing's TrustScoreRecord, not the deployment directly.
    // Join path: AgentDeployment → AgentDeployment.listingId → AgentListing.trustScore
    // The DeploymentStore.findById() must eager-load the listing relation.
    trustLevel: deployment?.listing?.trustScore ?? 0,
    deploymentType: deployment?.type ?? "standard",
    structureTemplates: getStructureTemplates(),
  };
}
```

### 5.3 Production Phase (Retry/Fallback Loop)

The most complex phase. Runs generation → QA → retry internally with spec-level parallelism.

```typescript
async function executeProductionPhase(ctx: PhaseExecutionContext): Promise<ProductionOutput> {
  const specs = (ctx.previousPhaseOutputs.scripting as ScriptingOutput).specs;
  const retryConfig = { maxAttempts: 3, maxProviderFallbacks: 2 };

  // Parallel execution with concurrency limit
  const limit = pLimit(3);
  const results = await Promise.all(
    specs.map((spec) => limit(() => processSpec(spec, ctx, retryConfig))),
  );

  // ... aggregate results ...
}

async function processSpec(spec, ctx, retryConfig): Promise<SpecResult> {
  // Rank providers ONCE per spec (outside attempt loop)
  const rankedProviders = rankProviders(
    spec,
    ctx.context.providerRegistry,
    ctx.context.providerHistory,
  )
    .filter((p) => p.profile.apiMaturity !== "low")
    .slice(0, retryConfig.maxProviderFallbacks + 1);

  const qaHistory: Array<{ attempt: number; provider: string; score: RealismScore }> = [];
  let totalCost = 0;

  for (const [providerIdx, provider] of rankedProviders.entries()) {
    for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
      // Budget guard
      if (totalCost > ctx.job.budget) {
        return { failed: true, reason: "budget exceeded" };
      }

      // Circuit breaker
      const failureRate =
        qaHistory.filter((h) => h.score.overallDecision === "fail").length /
        Math.max(qaHistory.length, 1);
      if (qaHistory.length >= 3 && failureRate > 0.8) {
        return { failed: true, reason: "circuit breaker: repeated QA failures" };
      }

      const startMs = Date.now();
      try {
        // Generate with timeout
        const raw = await Promise.race([
          generateWithProvider(spec, provider, ctx.deps),
          timeout(30_000).then(() => {
            throw new Error("generation timeout");
          }),
        ]);

        // QA
        const score = await evaluateRealism(raw, spec, ctx);
        qaHistory.push({ attempt, provider: provider.profile.provider, score });
        totalCost += provider.estimatedCost;

        if (score.overallDecision === "fail") {
          if (attempt < retryConfig.maxAttempts - 1) continue;
          break; // try next provider
        }

        // Pass or review → create asset
        return {
          asset: {
            // ... full asset record with provider metadata, QA, drift score ...
            approvalState: score.overallDecision === "pass" ? "approved" : "pending",
            latencyMs: Date.now() - startMs,
            costEstimate: provider.estimatedCost,
            attemptNumber: attempt + 1,
          },
          qaHistory,
        };
      } catch (err) {
        // last attempt, last provider → fail
      }
    }
  }

  // Final fallback: asset reuse
  if (spec.identityConstraints.strategy !== "asset_reuse") {
    const reusable = await ctx.deps.assetStore.findLockedByCreator(spec.creatorId);
    if (reusable) {
      return {
        asset: { ...reusable, lockedDerivativeOf: reusable.id, specId: spec.specId },
        qaHistory,
      };
    }
  }

  return { failed: true, reason: "all providers exhausted, no reusable asset", qaHistory };
}
```

### 5.4 Production Invariants

**Idempotency:** Each generation attempt is keyed by `specId + attemptNumber + provider`. If a step retries (Inngest retry), the same key produces the same asset record. Assets are persisted as "pending" immediately after generation, then QA metrics are attached. This is "write once, then enrich" — not "persist only after pass."

**Budget semantics:**

```typescript
interface JobBudget {
  totalJobBudget: number; // hard cap for entire job across all specs
  perSpecBudget: number; // max spend per individual spec (including retries)
  costAuthority: "estimated"; // use provider.estimatedCost (actual billing reconciled async)
}
```

- Budget is defined per job at submission time (stored in `ugcConfig`)
- `perSpecBudget` defaults to `totalJobBudget / specs.length` unless overridden
- Asset reuse is free (no generation cost)
- The budget guard checks `estimatedCost` at decision time, not actual billed cost (which arrives async from providers)

**Duplicate prevention:** If a step.run for generation succeeds but the subsequent persist step fails and Inngest retries the persist, the asset record uses `specId + attemptNumber + provider` as a unique constraint to prevent duplicate inserts.

### 5.5 Asset Classification

Three distinct asset states, not to be confused:

| State                               | Meaning                                                                     | How Created                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Newly generated**                 | Fresh generation from provider, QA'd and approved                           | Normal production flow                                                                               |
| **Exact asset reuse**               | Identical approved asset served again unchanged                             | `lockedDerivativeOf` points to original, `approvalState = "locked"`                                  |
| **Derivative from locked identity** | New generation using locked creator identity constraints, but novel content | `identityConstraints.strategy !== "asset_reuse"`, normal generation with strict identity constraints |

`lockedDerivativeOf` is set **only** for exact asset reuse. Derivatives with locked identity constraints are newly generated assets — they just happen to have strict identity enforcement.

### 5.6 Realism Threshold Configuration

QA thresholds are versioned deployment config, not hardcoded in spec code.

```typescript
interface QaThresholdConfig {
  version: string; // "v1", "v2", etc.
  deploymentId: string; // per-deployment overrides
  hardCheckDefaults: {
    faceSimilarityMin: number; // default: 0.7
    ocrAccuracyMin: number; // default: 0.8
    voiceSimilarityMin: number; // default: 0.75 (Phase 2+)
    criticalArtifacts: string[]; // flags that always fail: ["face_drift", "product_warp", "hand_warp"]
  };
  softScoreDefaults: {
    reviewThreshold: number; // default: 0.5 (below → review)
    weights: {
      // must sum to 1.0
      visualRealism: number; // default: 0.20
      behavioralRealism: number; // default: 0.20
      ugcAuthenticity: number; // default: 0.35
      audioNaturalness: number; // default: 0.25
    };
  };
}
```

- Default thresholds ship with the system
- Per-deployment overrides stored in `AgentDeployment.governanceSettings`
- `CreativeSpec.qaThresholds` can further override per-spec (set during planning phase)
- Threshold changes are versioned — a change to defaults creates a new config version so historical QA results remain interpretable

### 5.7 Approval Configuration

```typescript
interface ApprovalConfig {
  autoApproveThresholds: Record<UgcPhase, number>;
  alwaysRequireApproval: UgcPhase[];
}

const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  autoApproveThresholds: {
    planning: 55, // autonomous agents skip planning approval
    scripting: 55, // autonomous agents skip scripting approval
    production: 80, // only elite trust auto-approves production
    delivery: 80, // only elite trust auto-approves delivery
  },
  alwaysRequireApproval: [], // deployment can override
};

function shouldRequireApproval(ctx: {
  phase: UgcPhase;
  trustLevel: number;
  deploymentType: string;
}): boolean {
  const config = DEFAULT_APPROVAL_CONFIG;
  if (config.alwaysRequireApproval.includes(ctx.phase)) return true;
  return ctx.trustLevel < config.autoApproveThresholds[ctx.phase];
}
```

### 5.8 Dependency Injection

```typescript
interface UgcPipelineDeps {
  jobStore: UgcJobStore;
  creatorStore: CreatorIdentityStore;
  assetStore: AssetRecordStore;
  performanceStore: PerformanceMemoryStore;
  frictionStore: FunnelFrictionStore;
  providerRegistry: ProviderRegistry;
  deploymentStore: DeploymentStore;
  llmConfig: { apiKey: string };
  klingClient: KlingLike;
  heygenClient?: HeyGenLike;
  elevenLabsClient?: ElevenLabsLike;
  whisperClient?: WhisperLike;
  videoAssembler?: AssemblerLike;
}
```

### 5.9 Event Contract

```typescript
type UgcPipelineEvents = {
  "creative-pipeline/ugc.submitted": { jobId: string; deploymentId: string; mode: "ugc" };
  "creative-pipeline/ugc-phase.completed": {
    jobId: string;
    phase: UgcPhase;
    durationMs: number;
    substagesCompleted: string[];
    resultSummary: Record<string, unknown>;
  };
  "creative-pipeline/ugc-phase.approved": {
    jobId: string;
    phase: UgcPhase;
    action: "continue" | "stop";
  };
  "creative-pipeline/ugc.completed": { jobId: string; assetsProduced: number; failed: number };
  "creative-pipeline/ugc.stopped": { jobId: string; stoppedAtPhase: UgcPhase };
  "creative-pipeline/ugc.failed": { jobId: string; phase: UgcPhase; error: UgcPhaseError };
};
```

### 5.10 Error Handling & Failure Modes

Each phase can fail. The runner distinguishes **retryable** errors (transient infra) from **terminal** errors (bad input, impossible constraint) from **degraded** outcomes (partial success).

```typescript
type UgcErrorKind =
  | "retryable" // transient — Inngest step retry handles it
  | "terminal" // bad input or impossible constraint — stop the job
  | "degraded"; // partial success — continue with reduced output

interface UgcPhaseError {
  kind: UgcErrorKind;
  phase: UgcPhase;
  code: string; // machine-readable, e.g., "NO_ELIGIBLE_CREATORS"
  message: string; // human-readable
  context?: Record<string, unknown>;
}
```

**Per-phase failure modes:**

| Phase      | Error                                       | Kind      | Handling                                       |
| ---------- | ------------------------------------------- | --------- | ---------------------------------------------- |
| Planning   | No eligible creators in pool                | terminal  | Mark job failed, emit `ugc.failed` event       |
| Planning   | No structures match platform + friction     | terminal  | Mark job failed                                |
| Planning   | Performance memory store unavailable        | retryable | Inngest step retry (stub returns empty)        |
| Scripting  | Claude refuses script (policy/safety)       | terminal  | Mark job failed with `claimsPolicyTag`         |
| Scripting  | Claude timeout                              | retryable | Inngest step retry                             |
| Production | All providers exhausted + no reusable asset | terminal  | Mark job failed, persist partial assets        |
| Production | Single spec fails but others succeed        | degraded  | Continue, report in `failedSpecs`              |
| Production | Budget exceeded mid-batch                   | terminal  | Stop remaining specs, persist completed assets |
| Delivery   | Approval timeout (24h)                      | terminal  | Mark job stopped (existing pattern)            |
| Any        | Job not found                               | terminal  | Throw (Inngest retries, then dead-letters)     |

**Job terminal states** (mutually exclusive — a job ends in exactly one):

| State               | Meaning                                  | How Set                                                           |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `complete`          | All phases finished, assets delivered    | `ugcPhase = "complete"`, no `ugcFailure`                          |
| `stopped`           | Buyer or approval timeout halted the job | `stoppedAt` is set, no `ugcFailure`                               |
| `failed`            | Terminal error in a phase                | `ugcFailure` is set                                               |
| `degraded_complete` | Production partially succeeded           | `ugcPhase = "complete"`, `failedSpecs` non-empty in phase outputs |

Add `ugcFailure` field to `CreativeJob`:

```prisma
ugcFailure  Json?  // UgcPhaseError — set on terminal failure, null otherwise
```

The runner wraps each phase in a try/catch. Retryable errors are rethrown (Inngest handles). Terminal errors persist the failure and return:

```typescript
try {
  output = await step.run(`phase-${phase}`, () => executePhase(...));
} catch (err) {
  const phaseError = classifyError(err, phase);
  if (phaseError.kind === "retryable") throw err; // Inngest retries
  await step.run(`fail-${phase}`, () => deps.jobStore.failUgc(job.id, phase, phaseError));
  await step.sendEvent(`emit-failure`, {
    name: "creative-pipeline/ugc.failed",
    data: { jobId: job.id, phase, error: phaseError },
  });
  return;
}
```

---

## 6. Core Data Types

### 6.1 CreativeSpec

The main contract between Switchboard and any generator.

**Platform enum:** UGC uses a more specific `UgcPlatform` enum than the existing `CreativePlatform` (`"meta" | "youtube" | "tiktok"`). The mapping from `CreativeJob.platforms` to `UgcPlatform` happens in the planning phase:

```typescript
// UGC-specific platform targets (more granular than CreativePlatform)
type UgcPlatform = "meta_feed" | "instagram_reels" | "tiktok";

// Mapping from CreativePlatform → UgcPlatform (in planning phase)
function mapPlatform(platform: CreativePlatform): UgcPlatform[] {
  switch (platform) {
    case "meta":
      return ["meta_feed", "instagram_reels"]; // UGC targets both
    case "tiktok":
      return ["tiktok"];
    case "youtube":
      return []; // UGC v2 does not target YouTube (polished pipeline handles it)
  }
}
```

```typescript
interface CreativeSpec {
  specId: string;
  deploymentId: string;
  mode: "ugc";

  creatorId: string;
  structureId: string;
  motivator: string;
  platform: UgcPlatform; // see below

  script: {
    text: string;
    language: string;
    claimsPolicyTag?: string;
  };

  style: SceneStyle;
  direction: UGCDirection;

  format: "talking_head" | "lifestyle" | "product_in_hand" | "multi_shot";

  identityConstraints: {
    strategy: IdentityStrategy;
    requireExactReuse?: boolean;
    maxIdentityDrift: number;
    lockHairState?: boolean;
    lockWardrobe?: boolean;
  };

  // Defined in schema but ignored until SP10. SP1-SP5 include the field to avoid a
  // migration later, but the production phase treats it as undefined. No subsystem
  // produces or consumes shot chains before SP10.
  continuityConstraints?: {
    useFirstFrame?: boolean;
    useLastFrame?: boolean;
    allowExtension?: boolean;
    allowMotionTransfer?: boolean;
    shotChainId?: string;
  };

  renderTargets: {
    aspect: "9:16" | "1:1" | "4:5";
    durationSec: number;
    fps?: number;
    resolution?: string;
  };

  qaThresholds: {
    faceSimilarityMin: number;
    realismMin: number;
    ocrAccuracyMin?: number;
    voiceSimilarityMin?: number;
  };

  providersAllowed: string[];
  campaignTags: Record<string, string>;
}
```

### 6.2 CreatorIdentity (Zod)

```typescript
const VoiceSchema = z.object({
  voiceId: z.string(),
  provider: z.literal("elevenlabs"),
  tone: z.string(),
  pace: z.enum(["slow", "moderate", "fast"]),
  sampleUrl: z.string(),
  settings: z
    .object({
      stability: z.number().optional(),
      similarity: z.number().optional(),
      style: z.number().optional(),
    })
    .optional(),
});

const PersonalitySchema = z.object({
  energy: z.enum(["calm", "conversational", "energetic", "intense"]),
  deliveryStyle: z.string(),
  catchphrases: z.array(z.string()).optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
});

const AppearanceRulesSchema = z.object({
  hairStates: z.array(z.string()),
  wardrobePalette: z.array(z.string()),
  jewelryRules: z.array(z.string()).optional(),
  makeupRules: z.array(z.string()).optional(),
  forbiddenLooks: z.array(z.string()).optional(),
});

const ImperfectionProfile = z.object({
  hesitationDensity: z.number().min(0).max(1),
  sentenceRestartRate: z.number().min(0).max(1),
  microPauseDensity: z.number().min(0).max(1),
  fillerDensityTarget: z.number().min(0).max(0.5),
  fragmentationTarget: z.number().min(0).max(1),
});
```

### 6.3 SceneStyle & UGCDirection

```typescript
interface SceneStyle {
  lighting: "natural" | "ambient" | "golden_hour" | "overcast" | "ring_light";
  cameraAngle: "selfie" | "eye_level" | "slight_low" | "over_shoulder";
  cameraMovement: "handheld" | "static_tripod" | "slow_pan" | "none";
  environment: string; // from creator's environmentSet
  wardrobeSelection: string[]; // from creator's appearanceRules.wardrobePalette
  hairState: string; // from creator's appearanceRules.hairStates
  props: string[];
}

// UGCDirection fields are intent signals, not hard guarantees.
// They guide prompt construction and inform QA scoring, but providers may not
// support enforcing all of them natively. If a field cannot be enforced by the
// provider, the realism scorer treats it as a soft score input rather than a
// hard check. Fields that prove unstable across providers should be documented
// as "advisory only" during calibration.
interface UGCDirection {
  hookType: "direct_camera" | "mid_action" | "reaction" | "text_overlay_start";
  eyeContact: "camera" | "off_camera" | "mixed";
  energyLevel: "low" | "medium" | "high"; // must align with creator personality.energy
  pacingNotes: string; // e.g., "pause after claim, restart mid-sentence"
  imperfections: ImperfectionProfile;
  adLibPermissions: string[]; // allowed off-script moments
  forbiddenFraming: string[]; // e.g., "no studio lighting", "no centered framing"
}
```

**Design rationale:** `SceneStyle` captures what the viewer **sees**, `UGCDirection` captures how the creator **performs**. The polished pipeline's `visualDirection: string` is too loose — UGC needs structured fields so the realism scorer can validate outputs against intent (e.g., was lighting actually natural? Was camera actually handheld?).

---

## 7. Metrics & Observability

### 7.1 Creative Metrics (from ad platform — ingested later)

| Metric              | Used By                                 |
| ------------------- | --------------------------------------- |
| Thumbstop rate      | Structure performance, hook performance |
| Hold rate           | Script performance, creator performance |
| CTR                 | Overall creative quality                |
| Outbound click rate | CTA effectiveness                       |
| CPA / CPL           | Business value signal                   |

### 7.2 Identity Metrics (computed internally)

| Metric                   | Used By                             |
| ------------------------ | ----------------------------------- |
| Face cosine similarity   | Identity drift tracking, creator QA |
| Voice similarity         | Voice consistency enforcement       |
| Wardrobe violation rate  | Appearance rule enforcement         |
| Identity drift over time | Creator health monitoring           |

### 7.3 Pipeline Metrics (per phase)

| Metric                       | Used By                                |
| ---------------------------- | -------------------------------------- |
| Phase duration               | Bottleneck detection, cost attribution |
| Generation pass rate         | Provider comparison, retry tuning      |
| Reject rate by artifact type | QA threshold calibration               |
| Pass rate by provider        | Provider router learning               |
| Retry count per spec         | Cost optimization                      |
| Cost per asset               | Budget enforcement                     |

### 7.4 Funnel Metrics (per deployment)

| Metric                    | Used By                       |
| ------------------------- | ----------------------------- |
| Friction resolution score | Funnel feedback effectiveness |
| Lead qualification rate   | Friction detection            |
| Booking rate              | Friction detection            |
| Objection frequency       | Friction detection            |

### 7.5 Observability Contract

Every phase emits `creative-pipeline/ugc-phase.completed` with: `phase`, `durationMs`, `substagesCompleted`, `resultSummary`.

Production phase additionally records per-spec: provider used, attempt count, QA score history, cost estimate, latency.

---

## 8. Rollout & Sub-project Decomposition

### 8.1 Sub-projects

| SP   | Name                                  | Scope                                                                                                                                                                                                                        | Depends On     | Phase |
| ---- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----- |
| SP1  | UGC Data Models                       | `CreatorIdentity`, `AssetRecord` Prisma models, Zod schemas, stores, `mode` field on `CreativeJob`                                                                                                                           | Nothing        | 1     |
| SP2  | Mode Dispatcher + UGC Runner Skeleton | `mode-dispatcher.ts`, `ugc-job-runner.ts` with phase loop, no-op phases, approval gating, phase resume, event contract                                                                                                       | SP1            | 1     |
| SP3  | Planning Phase                        | Structure engine, scene caster, identity strategy router (reference_conditioning + asset_reuse), funnel friction translator (schema + translation, no ingestion)                                                             | SP2            | 1     |
| SP4  | Scripting Phase                       | UGC script writer, UGC director, imperfection injector, creator bible enforcement                                                                                                                                            | SP3            | 1     |
| SP5  | Production Phase                      | Provider router (Kling + HeyGen), generation, **minimal QA** (single Claude Vision pass returning pass/fail, no weighted scoring), retry/fallback, asset persistence, parallel specs, timeout, budget guard, circuit breaker | SP4            | 1     |
| SP6  | Realism Scorer v1                     | **Replaces SP5's minimal QA** with full hybrid scorer: face similarity, OCR, weighted soft scoring with 4 dimensions. The production phase code in Section 5.3 shows the target state after SP6.                             | SP5            | 2     |
| SP7  | Provider Expansion                    | Seedance + Runway adapters, provider performance history, cost tracking                                                                                                                                                      | SP5            | 2     |
| SP8  | Funnel Feedback Loop                  | Performance memory store, structure/creator/motivator tracking, friction writeback, decay enforcement                                                                                                                        | SP3            | 3     |
| SP9  | Realism Scorer v2                     | ArcFace/FaceNet embeddings, voice similarity, artifact classifiers, drift tracking                                                                                                                                           | SP6            | 3     |
| SP10 | Advanced Identity                     | Fine-tuned identity (LoRA/DreamBooth), multi-shot continuity, creator versioning, fatigue modeling                                                                                                                           | SP3            | 4     |
| SP11 | UGC Dashboard                         | Job submission, phase review, creator management, drift dashboards, QA queue                                                                                                                                                 | SP1 (parallel) | 1-2   |

**Build order:** SP1 → SP2 → SP3 → SP4 → SP5 → SP6 + SP7 + SP11 (parallel) → SP8 → SP9 → SP10

### 8.2 Phase 1 Definition of Done

- Buyer submits UGC job with creator pool
- Planning phase selects structures, casts creators, routes identity strategy
- Scripting phase produces UGC-native scripts with imperfections and creator voice
- Production phase generates via Kling, runs basic QA, retries on failure, falls back to asset reuse
- Assets persisted with full provenance (provider, model, input hashes, QA, attempt metadata)
- Approval gates work with trust-level awareness
- Phase resume works after crash/restart

### 8.3 Testing Strategy

Follows existing codebase patterns: `vi.mock()` for external deps, factory functions for mock objects, typed mock data matching Zod schemas.

**Unit tests (per subsystem):**

| Subsystem                  | What to test                                                                              | Mock boundary                         |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| Structure engine           | Weighted selection given known scores; fatigue penalty; empty performance memory fallback | None (pure function)                  |
| Scene caster               | Creator ranking given known affinities; repetition penalty; tie-breaking                  | None (pure function)                  |
| Identity strategy router   | Strategy selection per decision tree; fallback chain ordering                             | None (pure function)                  |
| Provider router            | Provider ranking; filtering by apiMaturity; capability matching                           | None (pure function)                  |
| Realism scorer             | Hard check failures → fail; soft score weighting; threshold edge cases                    | Mock Claude Vision (`call-claude.js`) |
| Funnel friction translator | Translation rules per friction type; conflict resolution; anti-overfitting cap            | None (pure function)                  |
| UGC script writer          | Creator voice enforcement; imperfection injection; forbidden phrases                      | Mock Claude (`call-claude.js`)        |

**Integration tests (per phase):**

| Phase      | What to test                                                              | Mock boundary                                              |
| ---------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Planning   | Full phase with real subsystems, mock stores                              | Stores (factory mocks)                                     |
| Scripting  | Full phase, mock Claude                                                   | `call-claude.js`                                           |
| Production | Retry loop, provider fallback, budget guard, circuit breaker, asset reuse | Provider clients, `call-claude.js`                         |
| Delivery   | Approval gate flow, trust-level bypass                                    | Stores, Inngest step (existing `createMockStep()` pattern) |

**Runner tests:**

- Phase resume from each possible `ugcPhase` value
- Approval timeout → job stopped
- Terminal error in phase → job marked failed
- Degraded production (some specs fail) → job completes with `failedSpecs`

**Idempotency & duplicate protection tests:**

- Production: generation step succeeds but persist step fails → Inngest retries persist → assert no duplicate `AssetRecord` (unique constraint on `specId + attemptNumber + provider`)
- Production: same spec retried after transient provider error → assert attempt counter increments, previous attempt's asset preserved
- Runner: entire function re-invoked after crash → assert resume from last completed phase, no re-execution of completed phases
- Approval: stale approval event from a previous phase → assert it does not unblock the current phase (matched on both `jobId` AND `phase`)

**What NOT to test:**

- Claude prompt quality (validated by QA metrics in production, not unit tests)
- Provider API contracts (mocked at client boundary, provider-specific tests live in client files)

---

## 9. Risks & Mitigations

| Risk                                    | Impact                                    | Mitigation                                                                                                                  |
| --------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Claude Vision QA too subjective         | False passes/rejects                      | Phase 1 accepts this. Phase 2 adds specialized models. Track false positive/negative rates.                                 |
| Kling is the only production provider   | Single point of failure                   | Asset reuse as final fallback. Provider router ready for expansion. Don't block launch.                                     |
| Creator identity drift                  | Creator unrecognizable over repeated jobs | Drift tracking per asset. Baseline comparison. Alert on threshold breach. Phase 4 adds fine-tuned identity.                 |
| Funnel friction ingestion doesn't exist | Feedback engine has no signals            | Pipeline consumes frictions but doesn't require them. Empty frictions = pure creative-side selection. Graceful degradation. |
| UGC scripts still sound too polished    | Defeats UGC mode purpose                  | Imperfection injector with tunable parameters. Creator personality enforcement. A/B test against polished.                  |
| Phase resume loses partial work         | Wasted API cost                           | Inngest step-level checkpointing. Partial outputs persisted per substage.                                                   |
| Production cost runaway                 | Uncontrolled spend                        | Budget guard. Circuit breaker. Max 3 attempts × 2 fallbacks = 9 calls ceiling per spec.                                     |
| `ugcPhaseOutputs` JSON growth           | DB bloat                                  | Media in object storage, JSON stores URLs only. Version field for migration.                                                |
| Weight calibration wrong at launch      | Bad structure/creator selection           | Log all decisions. Compare against outcomes. Adjust weights over time. All weights configurable.                            |
| Multiple funnel frictions conflict      | Contradictory script constraints          | Conflict resolution: prioritize by confidence, cap active directives, merge compatible priorities.                          |

---

## 10. Out of Scope (Deferred)

- **Signal ingestion system** — how `FunnelFriction` records are created from CRM/chat/sales/ads data (separate spec)
- **Ads API integration** — pulling creative performance metrics back into Switchboard
- **Multi-language UGC** — creator personalities and scripts in non-English languages
- **A/B testing framework** — systematic creative variant testing with statistical significance
- **Real-time notifications** — webhook/push for phase completion (polling for MVP)
- **Creator marketplace** — sharing creators across deployments
- **Automated publishing** — direct posting to Meta/TikTok (manual upload for now)
