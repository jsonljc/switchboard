# UGC v2 SP1 — Data Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data foundation for UGC v2 — Prisma models, Zod schemas, store implementations, and the `mode` field extension to the existing creative pipeline.

**Architecture:** Extend `CreativeJob` with UGC-specific fields (`mode`, `ugcPhase`, `ugcPhaseOutputs`, `ugcConfig`, `ugcFailure`). Add two new models (`CreatorIdentity`, `AssetRecord`). Create seven new Zod schema files in `packages/schemas/src/`. Create two new store classes in `packages/db/src/stores/`. Update the API route to accept `mode` on job submission.

**Tech Stack:** Prisma (PostgreSQL), Zod, Vitest, TypeScript ESM

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 3.1–3.5, 6.1–6.3, 5.10

---

## File Map

### New files

| File                                                                     | Responsibility                                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/ugc-job.ts`                                        | UGC phase enum, UGC brief, phase output stubs, UGC config, CreativeSpec, SceneStyle, UGCDirection, UgcPhaseError |
| `packages/schemas/src/creator-identity.ts`                               | CreatorIdentity Zod schema (voice, personality, appearance, imperfection profile)                                |
| `packages/schemas/src/asset-record.ts`                                   | AssetRecord Zod schema, input hash schema, approval state enum                                                   |
| `packages/schemas/src/identity-strategy.ts`                              | IdentityStrategy enum, IdentityPlan schema                                                                       |
| `packages/schemas/src/provider-capabilities.ts`                          | ProviderRole enum, ProviderCapabilityProfile schema                                                              |
| `packages/schemas/src/realism-score.ts`                                  | RealismScore schema (hardChecks + softScores + overallDecision)                                                  |
| `packages/schemas/src/funnel-friction.ts`                                | FrictionType enum, FunnelFriction schema, CreativeWeights schema                                                 |
| `packages/db/src/stores/prisma-creator-identity-store.ts`                | CRUD for CreatorIdentity                                                                                         |
| `packages/db/src/stores/prisma-asset-record-store.ts`                    | CRUD for AssetRecord with idempotent upsert                                                                      |
| `packages/db/src/stores/__tests__/prisma-creator-identity-store.test.ts` | Tests for CreatorIdentity store                                                                                  |
| `packages/db/src/stores/__tests__/prisma-asset-record-store.test.ts`     | Tests for AssetRecord store                                                                                      |

### Modified files

| File                                                                 | Change                                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                   | Add `mode`, `ugcPhase`, `ugcPhaseOutputs`, `ugcPhaseOutputsVersion`, `ugcConfig`, `ugcFailure` to `CreativeJob`. Add `CreatorIdentity` and `AssetRecord` models. |
| `packages/schemas/src/creative-job.ts`                               | Add `mode` to `CreativeJobSchema`, add `CreativeJobMode` enum, add `UgcPhase` enum                                                                               |
| `packages/schemas/src/index.ts`                                      | Re-export new schema files                                                                                                                                       |
| `packages/db/src/stores/prisma-creative-job-store.ts`                | Add UGC methods: `createUgc()`, `updateUgcPhase()`, `failUgc()`, `stopUgc()` with mode invariant enforcement                                                     |
| `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts` | Tests for new UGC methods + mode invariant                                                                                                                       |
| `packages/db/src/index.ts`                                           | Re-export new store classes                                                                                                                                      |
| `apps/api/src/routes/creative-pipeline.ts`                           | Accept `mode` on job submission, pass to store                                                                                                                   |

---

## Task 1: Prisma Schema — Extend CreativeJob + Add New Models

**Files:**

- Modify: `packages/db/prisma/schema.prisma:952-981`

- [ ] **Step 1: Add UGC fields to CreativeJob model**

In `packages/db/prisma/schema.prisma`, find `model CreativeJob` and add UGC fields after `productionTier`:

```prisma
model CreativeJob {
  id              String   @id @default(cuid())
  taskId          String   @unique
  organizationId  String
  deploymentId    String

  // Brief (input)
  productDescription  String
  targetAudience      String
  platforms           String[]
  brandVoice          String?
  productImages       String[]   @default([])
  references          String[]   @default([])
  pastPerformance     Json?
  generateReferenceImages  Boolean  @default(false)

  // Pipeline state (polished)
  currentStage    String   @default("trends")
  stageOutputs    Json     @default("{}")
  stoppedAt       String?
  productionTier  String?

  // Pipeline mode
  mode                    String   @default("polished")

  // UGC pipeline state (nullable — only populated when mode = "ugc")
  ugcPhase                String?
  ugcPhaseOutputs         Json?
  ugcPhaseOutputsVersion  String?  @default("v1")
  ugcConfig               Json?
  ugcFailure              Json?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  task AgentTask @relation(fields: [taskId], references: [id])
  assets AssetRecord[]

  @@index([organizationId])
  @@index([deploymentId])
  @@index([mode])
}
```

- [ ] **Step 2: Add CreatorIdentity model**

Add after `CreativeJob` model:

```prisma
model CreatorIdentity {
  id                  String   @id @default(cuid())
  deploymentId        String
  name                String

  identityRefIds      String[]
  heroImageAssetId    String
  identityDescription String

  identityObjects     Json?

  voice               Json
  personality         Json
  appearanceRules     Json

  environmentSet      String[]

  approved            Boolean  @default(false)
  isActive            Boolean  @default(true)
  bibleVersion        String   @default("1.0")
  previousVersionId   String?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  assets              AssetRecord[]

  @@index([deploymentId])
}
```

- [ ] **Step 3: Add AssetRecord model**

Add after `CreatorIdentity` model:

```prisma
model AssetRecord {
  id                  String   @id @default(cuid())
  jobId               String
  job                 CreativeJob @relation(fields: [jobId], references: [id])
  specId              String
  creatorId           String?
  creator             CreatorIdentity? @relation(fields: [creatorId], references: [id])

  provider            String
  modelId             String
  modelVersion        String?
  seed                Int?

  inputHashes         Json
  outputs             Json

  qaMetrics           Json?
  qaHistory           Json?

  identityDriftScore  Float?
  baselineAssetId     String?

  latencyMs           Int?
  costEstimate        Float?
  attemptNumber       Int?

  approvalState       String   @default("pending")
  lockedDerivativeOf  String?

  createdAt           DateTime @default(now())

  @@unique([specId, attemptNumber, provider])
  @@index([jobId])
  @@index([specId])
  @@index([creatorId])
  @@index([approvalState])
}
```

Note the `@@unique([specId, attemptNumber, provider])` — this enforces idempotent asset creation per the spec's duplicate prevention requirement (Section 5.4).

- [ ] **Step 4: Generate Prisma client and create migration**

```bash
cd /Users/jasonljc/switchboard
npx pnpm@9.15.4 db:generate
npx prisma migrate dev --name add_ugc_v2_models --schema packages/db/prisma/schema.prisma
```

Expected: Migration created, Prisma client regenerated with new types.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add UGC v2 Prisma models — CreatorIdentity, AssetRecord, CreativeJob mode extension"
```

---

## Task 2: Zod Schemas — Realism Score, Identity Strategy, Provider Capabilities

These three schemas have no internal dependencies and are consumed by later schemas. Build them first.

**Files:**

- Create: `packages/schemas/src/realism-score.ts`
- Create: `packages/schemas/src/identity-strategy.ts`
- Create: `packages/schemas/src/provider-capabilities.ts`

- [ ] **Step 1: Create realism-score.ts**

```typescript
// packages/schemas/src/realism-score.ts
import { z } from "zod";

export const RealismHardChecks = z.object({
  faceSimilarity: z.number().min(0).max(1).optional(),
  ocrAccuracy: z.number().min(0).max(1).optional(),
  voiceSimilarity: z.number().min(0).max(1).optional(),
  lipSyncScore: z.number().min(0).max(1).optional(),
  artifactFlags: z.array(z.string()),
});
export type RealismHardChecks = z.infer<typeof RealismHardChecks>;

export const RealismSoftScores = z.object({
  visualRealism: z.number().min(0).max(1).optional(),
  behavioralRealism: z.number().min(0).max(1).optional(),
  ugcAuthenticity: z.number().min(0).max(1).optional(),
  audioNaturalness: z.number().min(0).max(1).optional(),
});
export type RealismSoftScores = z.infer<typeof RealismSoftScores>;

export const RealismDecision = z.enum(["pass", "review", "fail"]);
export type RealismDecision = z.infer<typeof RealismDecision>;

export const RealismScoreSchema = z.object({
  hardChecks: RealismHardChecks,
  softScores: RealismSoftScores,
  overallDecision: RealismDecision,
});
export type RealismScore = z.infer<typeof RealismScoreSchema>;
```

- [ ] **Step 2: Create identity-strategy.ts**

```typescript
// packages/schemas/src/identity-strategy.ts
import { z } from "zod";

export const IdentityStrategy = z.enum([
  "platform_identity",
  "reference_conditioning",
  "fine_tuned_identity",
  "asset_reuse",
]);
export type IdentityStrategy = z.infer<typeof IdentityStrategy>;

export const IdentityPlanSchema = z.object({
  creatorId: z.string(),
  primaryStrategy: IdentityStrategy,
  fallbackChain: z.array(IdentityStrategy),
  constraints: z.object({
    maxIdentityDrift: z.number().min(0).max(1),
    lockHairState: z.boolean(),
    lockWardrobe: z.boolean(),
    requireExactReuse: z.boolean(),
  }),
});
export type IdentityPlan = z.infer<typeof IdentityPlanSchema>;
```

- [ ] **Step 3: Create provider-capabilities.ts**

```typescript
// packages/schemas/src/provider-capabilities.ts
import { z } from "zod";

export const ProviderRole = z.enum(["production", "narrow_use", "planned", "tooling"]);
export type ProviderRole = z.infer<typeof ProviderRole>;

export const ApiMaturity = z.enum(["high", "medium", "low"]);
export type ApiMaturity = z.infer<typeof ApiMaturity>;

export const IdentityStrength = z.enum(["high", "medium", "low"]);
export type IdentityStrength = z.infer<typeof IdentityStrength>;

export const ProviderCapabilityProfileSchema = z.object({
  provider: z.string(),
  role: ProviderRole,
  identityStrength: IdentityStrength,
  supportsIdentityObject: z.boolean(),
  supportsReferenceImages: z.boolean(),
  supportsFirstLastFrame: z.boolean(),
  supportsExtension: z.boolean(),
  supportsMotionTransfer: z.boolean(),
  supportsMultiShot: z.boolean(),
  supportsAudioDrivenTalkingHead: z.boolean(),
  supportsProductTextIntegrity: z.boolean(),
  apiMaturity: ApiMaturity,
  seedSupport: z.boolean(),
  versionPinning: z.boolean(),
});
export type ProviderCapabilityProfile = z.infer<typeof ProviderCapabilityProfileSchema>;
```

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/realism-score.ts packages/schemas/src/identity-strategy.ts packages/schemas/src/provider-capabilities.ts
git commit -m "feat(schemas): add realism-score, identity-strategy, provider-capabilities Zod schemas"
```

---

## Task 3: Zod Schemas — Creator Identity, Funnel Friction

**Files:**

- Create: `packages/schemas/src/creator-identity.ts`
- Create: `packages/schemas/src/funnel-friction.ts`

- [ ] **Step 1: Create creator-identity.ts**

```typescript
// packages/schemas/src/creator-identity.ts
import { z } from "zod";

export const VoiceSchema = z.object({
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
export type Voice = z.infer<typeof VoiceSchema>;

export const PersonalitySchema = z.object({
  energy: z.enum(["calm", "conversational", "energetic", "intense"]),
  deliveryStyle: z.string(),
  catchphrases: z.array(z.string()).optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
});
export type Personality = z.infer<typeof PersonalitySchema>;

export const AppearanceRulesSchema = z.object({
  hairStates: z.array(z.string()),
  wardrobePalette: z.array(z.string()),
  jewelryRules: z.array(z.string()).optional(),
  makeupRules: z.array(z.string()).optional(),
  forbiddenLooks: z.array(z.string()).optional(),
});
export type AppearanceRules = z.infer<typeof AppearanceRulesSchema>;

export const ImperfectionProfileSchema = z.object({
  hesitationDensity: z.number().min(0).max(1),
  sentenceRestartRate: z.number().min(0).max(1),
  microPauseDensity: z.number().min(0).max(1),
  fillerDensityTarget: z.number().min(0).max(0.5),
  fragmentationTarget: z.number().min(0).max(1),
});
export type ImperfectionProfile = z.infer<typeof ImperfectionProfileSchema>;

export const CreatorIdentitySchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  name: z.string(),
  identityRefIds: z.array(z.string()),
  heroImageAssetId: z.string(),
  identityDescription: z.string(),
  identityObjects: z.record(z.string()).nullable().optional(),
  voice: VoiceSchema,
  personality: PersonalitySchema,
  appearanceRules: AppearanceRulesSchema,
  environmentSet: z.array(z.string()),
  approved: z.boolean(),
  isActive: z.boolean(),
  bibleVersion: z.string(),
  previousVersionId: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CreatorIdentity = z.infer<typeof CreatorIdentitySchema>;
```

- [ ] **Step 2: Create funnel-friction.ts**

```typescript
// packages/schemas/src/funnel-friction.ts
import { z } from "zod";

export const FrictionType = z.enum([
  "low_trust",
  "price_shock",
  "expectation_mismatch",
  "weak_hook",
  "offer_confusion",
  "low_urgency",
  "weak_demo",
  "poor_social_proof",
]);
export type FrictionType = z.infer<typeof FrictionType>;

export const FrictionConfidence = z.enum(["low", "medium", "high"]);
export type FrictionConfidence = z.infer<typeof FrictionConfidence>;

export const FrictionSource = z.enum([
  "crm",
  "chat",
  "sales_agent",
  "ads",
  "call_review",
  "manual",
]);
export type FrictionSource = z.infer<typeof FrictionSource>;

export const FunnelFrictionSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  frictionType: FrictionType,
  source: FrictionSource,
  confidence: FrictionConfidence,
  evidenceCount: z.number().int().min(0),
  firstSeenAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  notes: z.array(z.string()).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type FunnelFriction = z.infer<typeof FunnelFrictionSchema>;

export const CreativeWeightsSchema = z.object({
  structurePriorities: z.record(z.number()),
  motivatorPriorities: z.record(z.number()),
  scriptConstraints: z.array(z.string()),
  hookDirectives: z.array(z.string()),
});
export type CreativeWeights = z.infer<typeof CreativeWeightsSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/creator-identity.ts packages/schemas/src/funnel-friction.ts
git commit -m "feat(schemas): add creator-identity and funnel-friction Zod schemas"
```

---

## Task 4: Zod Schemas — UGC Job, Asset Record, CreativeJob Extension

**Files:**

- Create: `packages/schemas/src/ugc-job.ts`
- Create: `packages/schemas/src/asset-record.ts`
- Modify: `packages/schemas/src/creative-job.ts`

- [ ] **Step 1: Create ugc-job.ts**

```typescript
// packages/schemas/src/ugc-job.ts
import { z } from "zod";
import { CreativeBriefInput } from "./creative-job.js";
import { ImperfectionProfileSchema } from "./creator-identity.js";
import { IdentityStrategy } from "./identity-strategy.js";

// ── Enums ──

export const UgcPhase = z.enum(["planning", "scripting", "production", "delivery", "complete"]);
export type UgcPhase = z.infer<typeof UgcPhase>;

export const UgcFormat = z.enum(["talking_head", "lifestyle", "product_in_hand", "multi_shot"]);
export type UgcFormat = z.infer<typeof UgcFormat>;

export const UgcPlatform = z.enum(["meta_feed", "instagram_reels", "tiktok"]);
export type UgcPlatform = z.infer<typeof UgcPlatform>;

export const UgcErrorKind = z.enum(["retryable", "terminal", "degraded"]);
export type UgcErrorKind = z.infer<typeof UgcErrorKind>;

// ── Error ──

export const UgcPhaseErrorSchema = z.object({
  kind: UgcErrorKind,
  phase: UgcPhase,
  code: z.string(),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
});
export type UgcPhaseError = z.infer<typeof UgcPhaseErrorSchema>;

// ── UGC Brief (extends CreativeBriefInput) ──

export const UgcBriefSchema = CreativeBriefInput.extend({
  creatorPoolIds: z.array(z.string()),
  ugcFormat: UgcFormat,
  imperfectionProfile: ImperfectionProfileSchema.optional(),
});
export type UgcBrief = z.infer<typeof UgcBriefSchema>;

// ── UGC Config ──

export const UgcConfigSchema = z.object({
  brief: UgcBriefSchema,
  budget: z
    .object({
      totalJobBudget: z.number(),
      perSpecBudget: z.number().optional(),
      costAuthority: z.literal("estimated"),
    })
    .optional(),
  retryConfig: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(3),
      maxProviderFallbacks: z.number().int().min(0).max(5).default(2),
    })
    .optional(),
});
export type UgcConfig = z.infer<typeof UgcConfigSchema>;

// ── Scene Style & UGC Direction ──

export const SceneStyleSchema = z.object({
  lighting: z.enum(["natural", "ambient", "golden_hour", "overcast", "ring_light"]),
  cameraAngle: z.enum(["selfie", "eye_level", "slight_low", "over_shoulder"]),
  cameraMovement: z.enum(["handheld", "static_tripod", "slow_pan", "none"]),
  environment: z.string(),
  wardrobeSelection: z.array(z.string()),
  hairState: z.string(),
  props: z.array(z.string()),
});
export type SceneStyle = z.infer<typeof SceneStyleSchema>;

export const UgcDirectionSchema = z.object({
  hookType: z.enum(["direct_camera", "mid_action", "reaction", "text_overlay_start"]),
  eyeContact: z.enum(["camera", "off_camera", "mixed"]),
  energyLevel: z.enum(["low", "medium", "high"]),
  pacingNotes: z.string(),
  imperfections: ImperfectionProfileSchema,
  adLibPermissions: z.array(z.string()),
  forbiddenFraming: z.array(z.string()),
});
export type UgcDirection = z.infer<typeof UgcDirectionSchema>;

// ── Identity Constraints ──

export const IdentityConstraintsSchema = z.object({
  strategy: IdentityStrategy,
  requireExactReuse: z.boolean().optional(),
  maxIdentityDrift: z.number().min(0).max(1),
  lockHairState: z.boolean().optional(),
  lockWardrobe: z.boolean().optional(),
});
export type IdentityConstraints = z.infer<typeof IdentityConstraintsSchema>;

// ── Continuity Constraints (deferred until SP10) ──

export const ContinuityConstraintsSchema = z.object({
  useFirstFrame: z.boolean().optional(),
  useLastFrame: z.boolean().optional(),
  allowExtension: z.boolean().optional(),
  allowMotionTransfer: z.boolean().optional(),
  shotChainId: z.string().optional(),
});
export type ContinuityConstraints = z.infer<typeof ContinuityConstraintsSchema>;

// ── QA Thresholds ──

export const QaThresholdsSchema = z.object({
  faceSimilarityMin: z.number().min(0).max(1),
  realismMin: z.number().min(0).max(1),
  ocrAccuracyMin: z.number().min(0).max(1).optional(),
  voiceSimilarityMin: z.number().min(0).max(1).optional(),
});
export type QaThresholds = z.infer<typeof QaThresholdsSchema>;

// ── Creative Spec ──

export const CreativeSpecSchema = z.object({
  specId: z.string(),
  deploymentId: z.string(),
  mode: z.literal("ugc"),
  creatorId: z.string(),
  structureId: z.string(),
  motivator: z.string(),
  platform: UgcPlatform,
  script: z.object({
    text: z.string(),
    language: z.string(),
    claimsPolicyTag: z.string().optional(),
  }),
  style: SceneStyleSchema,
  direction: UgcDirectionSchema,
  format: UgcFormat,
  identityConstraints: IdentityConstraintsSchema,
  continuityConstraints: ContinuityConstraintsSchema.optional(),
  renderTargets: z.object({
    aspect: z.enum(["9:16", "1:1", "4:5"]),
    durationSec: z.number(),
    fps: z.number().optional(),
    resolution: z.string().optional(),
  }),
  qaThresholds: QaThresholdsSchema,
  providersAllowed: z.array(z.string()),
  campaignTags: z.record(z.string()),
});
export type CreativeSpec = z.infer<typeof CreativeSpecSchema>;
```

- [ ] **Step 2: Create asset-record.ts**

```typescript
// packages/schemas/src/asset-record.ts
import { z } from "zod";

export const AssetApprovalState = z.enum(["pending", "approved", "rejected", "locked"]);
export type AssetApprovalState = z.infer<typeof AssetApprovalState>;

export const InputHashesSchema = z.object({
  referencesHash: z.string(),
  promptHash: z.string(),
  audioHash: z.string().optional(),
});
export type InputHashes = z.infer<typeof InputHashesSchema>;

export const AssetOutputsSchema = z.object({
  videoUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  checksums: z.record(z.string()),
});
export type AssetOutputs = z.infer<typeof AssetOutputsSchema>;

export const AssetRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  specId: z.string(),
  creatorId: z.string().nullable().optional(),
  provider: z.string(),
  modelId: z.string(),
  modelVersion: z.string().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  inputHashes: InputHashesSchema,
  outputs: AssetOutputsSchema,
  qaMetrics: z.record(z.unknown()).nullable().optional(),
  qaHistory: z.array(z.record(z.unknown())).nullable().optional(),
  identityDriftScore: z.number().nullable().optional(),
  baselineAssetId: z.string().nullable().optional(),
  latencyMs: z.number().int().nullable().optional(),
  costEstimate: z.number().nullable().optional(),
  attemptNumber: z.number().int().nullable().optional(),
  approvalState: AssetApprovalState,
  lockedDerivativeOf: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;
```

- [ ] **Step 3: Extend CreativeJobSchema with mode field**

In `packages/schemas/src/creative-job.ts`, add `CreativeJobMode` enum and extend `CreativeJobSchema`:

Add after the `CreativeJobStage` enum (line 6):

```typescript
export const CreativeJobMode = z.enum(["polished", "ugc"]);
export type CreativeJobMode = z.infer<typeof CreativeJobMode>;
```

Add these fields to `CreativeJobSchema` after `stoppedAt`:

```typescript
  mode: CreativeJobMode.default("polished"),
  ugcPhase: z.string().nullable().optional(),
  ugcPhaseOutputs: z.record(z.unknown()).nullable().optional(),
  ugcPhaseOutputsVersion: z.string().nullable().optional(),
  ugcConfig: z.record(z.unknown()).nullable().optional(),
  ugcFailure: z.record(z.unknown()).nullable().optional(),
```

- [ ] **Step 4: Run typecheck to verify schemas compile**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/schemas build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/ugc-job.ts packages/schemas/src/asset-record.ts packages/schemas/src/creative-job.ts
git commit -m "feat(schemas): add UGC job, asset record, and CreativeJob mode extension schemas"
```

---

## Task 5: Schema Barrel Exports

**Files:**

- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Add re-exports for all new schema files**

Add at the end of `packages/schemas/src/index.ts`:

```typescript
// UGC v2 — Creative Pipeline
export * from "./ugc-job.js";
export * from "./creator-identity.js";
export * from "./asset-record.js";
export * from "./identity-strategy.js";
export * from "./provider-capabilities.js";
export * from "./realism-score.js";
export * from "./funnel-friction.js";
```

- [ ] **Step 2: Build schemas package to verify exports**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/schemas build
```

Expected: Build succeeds, all exports resolve.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/index.ts
git commit -m "feat(schemas): export UGC v2 schema modules from barrel"
```

---

## Task 6: CreativeJob Store — UGC Methods + Mode Invariant

**Files:**

- Modify: `packages/db/src/stores/prisma-creative-job-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`

- [ ] **Step 1: Write failing tests for UGC store methods**

Add these test blocks to `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`:

```typescript
describe("createUgc", () => {
  it("creates a UGC job with mode='ugc' and initial ugcPhase", async () => {
    const input = {
      taskId: "task_1",
      organizationId: "org_1",
      deploymentId: "dep_1",
      productDescription: "AI scheduling tool",
      targetAudience: "Small business owners",
      platforms: ["meta"],
      brandVoice: null,
      productImages: [],
      references: [],
      pastPerformance: null,
      generateReferenceImages: false,
      ugcConfig: { brief: { creatorPoolIds: ["c1"], ugcFormat: "talking_head" } },
    };

    const expected = {
      id: "cj_ugc_1",
      ...input,
      mode: "ugc",
      ugcPhase: "planning",
      ugcPhaseOutputs: {},
      ugcPhaseOutputsVersion: "v1",
      ugcConfig: input.ugcConfig,
      ugcFailure: null,
      currentStage: "trends",
      stageOutputs: {},
      stoppedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.creativeJob.create.mockResolvedValue(expected);

    const result = await store.createUgc(input);

    expect(prisma.creativeJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mode: "ugc",
        ugcPhase: "planning",
        ugcConfig: input.ugcConfig,
      }),
    });
    expect(result.mode).toBe("ugc");
  });
});

describe("updateUgcPhase", () => {
  it("updates ugcPhase and ugcPhaseOutputs", async () => {
    const updated = {
      id: "cj_1",
      mode: "ugc",
      ugcPhase: "scripting",
      ugcPhaseOutputs: { planning: { structures: [] } },
    };
    prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
    prisma.creativeJob.update.mockResolvedValue(updated);

    const result = await store.updateUgcPhase("cj_1", "scripting", {
      planning: { structures: [] },
    });

    expect(result.ugcPhase).toBe("scripting");
  });

  it("rejects update on polished-mode job", async () => {
    prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });

    await expect(store.updateUgcPhase("cj_1", "scripting", {})).rejects.toThrow(
      "Cannot update UGC phase on a polished-mode job",
    );
  });
});

describe("failUgc", () => {
  it("sets ugcFailure on the job", async () => {
    const error = {
      kind: "terminal",
      phase: "planning",
      code: "NO_ELIGIBLE_CREATORS",
      message: "No creators",
    };
    prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
    prisma.creativeJob.update.mockResolvedValue({ id: "cj_1", ugcFailure: error });

    const result = await store.failUgc("cj_1", "planning", error);

    expect(prisma.creativeJob.update).toHaveBeenCalledWith({
      where: { id: "cj_1" },
      data: expect.objectContaining({
        ugcFailure: error,
        ugcPhase: "planning",
      }),
    });
    expect(result.ugcFailure).toEqual(error);
  });

  it("rejects failUgc on polished-mode job", async () => {
    prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "polished" });

    await expect(
      store.failUgc("cj_1", "planning", {
        kind: "terminal",
        phase: "planning",
        code: "X",
        message: "X",
      }),
    ).rejects.toThrow("Cannot update UGC phase on a polished-mode job");
  });
});

describe("stopUgc", () => {
  it("stops a UGC job at the given phase", async () => {
    prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });
    prisma.creativeJob.update.mockResolvedValue({
      id: "cj_1",
      stoppedAt: "scripting",
      ugcPhase: "scripting",
    });

    const result = await store.stopUgc("cj_1", "scripting");

    expect(prisma.creativeJob.update).toHaveBeenCalledWith({
      where: { id: "cj_1" },
      data: { stoppedAt: "scripting", ugcPhase: "scripting" },
    });
    expect(result.stoppedAt).toBe("scripting");
  });
});

describe("mode invariant on updateStage", () => {
  it("rejects updateStage on ugc-mode job", async () => {
    prisma.creativeJob.findUnique.mockResolvedValue({ id: "cj_1", mode: "ugc" });

    await expect(store.updateStage("cj_1", "hooks", {})).rejects.toThrow(
      "Cannot update polished stage on a UGC-mode job",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creative-job-store
```

Expected: New tests FAIL (methods don't exist yet).

- [ ] **Step 3: Implement UGC methods in prisma-creative-job-store.ts**

Add to `PrismaCreativeJobStore` class and update `updateStage`:

```typescript
  // ── Mode invariant helper ──

  private async assertMode(id: string, expectedMode: "polished" | "ugc"): Promise<void> {
    const job = await this.prisma.creativeJob.findUnique({ where: { id }, select: { mode: true } });
    if (!job) throw new Error(`Creative job not found: ${id}`);
    if (expectedMode === "ugc" && job.mode !== "ugc") {
      throw new Error("Cannot update UGC phase on a polished-mode job");
    }
    if (expectedMode === "polished" && job.mode === "ugc") {
      throw new Error("Cannot update polished stage on a UGC-mode job");
    }
  }

  // ── UGC methods ──

  async createUgc(
    input: CreateCreativeJobInput & { ugcConfig: Record<string, unknown> },
  ): Promise<CreativeJob> {
    return this.prisma.creativeJob.create({
      data: {
        taskId: input.taskId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        platforms: input.platforms,
        brandVoice: input.brandVoice,
        productImages: input.productImages,
        references: input.references,
        pastPerformance: input.pastPerformance
          ? (input.pastPerformance as object)
          : Prisma.JsonNull,
        generateReferenceImages: input.generateReferenceImages,
        mode: "ugc",
        ugcPhase: "planning",
        ugcPhaseOutputs: {},
        ugcPhaseOutputsVersion: "v1",
        ugcConfig: input.ugcConfig as object,
      },
    }) as unknown as CreativeJob;
  }

  async updateUgcPhase(
    id: string,
    phase: string,
    phaseOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        ugcPhase: phase,
        ugcPhaseOutputs: phaseOutputs as object,
      },
    }) as unknown as CreativeJob;
  }

  async failUgc(
    id: string,
    phase: string,
    error: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        ugcPhase: phase,
        ugcFailure: error as object,
      },
    }) as unknown as CreativeJob;
  }

  async stopUgc(id: string, phase: string): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    return this.prisma.creativeJob.update({
      where: { id },
      data: { stoppedAt: phase, ugcPhase: phase },
    }) as unknown as CreativeJob;
  }
```

Update `updateStage` to enforce mode invariant:

```typescript
  async updateStage(
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "polished");
    return this.prisma.creativeJob.update({
      where: { id },
      data: {
        currentStage: stage,
        stageOutputs: stageOutputs as object,
      },
    }) as unknown as CreativeJob;
  }
```

- [ ] **Step 4: Update mock in test file**

Update `createMockPrisma` to include `findUnique` alongside existing mocks (it's already there — just confirm the mock setup handles the `select` variant from `assertMode`). The existing `findUnique` mock will work because `vi.fn()` returns `undefined` for unknown args unless explicitly mocked per test.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creative-job-store
```

Expected: All tests PASS (both old and new).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
git commit -m "feat(db): add UGC methods to CreativeJobStore with mode invariant enforcement"
```

---

## Task 7: Creator Identity Store

**Files:**

- Create: `packages/db/src/stores/prisma-creator-identity-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-creator-identity-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/db/src/stores/__tests__/prisma-creator-identity-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentityStore } from "../prisma-creator-identity-store.js";

function createMockPrisma() {
  return {
    creatorIdentity: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaCreatorIdentityStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreatorIdentityStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreatorIdentityStore(prisma as never);
  });

  describe("create", () => {
    it("creates a creator identity", async () => {
      const input = {
        deploymentId: "dep_1",
        name: "Sofia",
        identityRefIds: [],
        heroImageAssetId: "asset_hero",
        identityDescription: "Friendly lifestyle creator",
        voice: {
          voiceId: "v1",
          provider: "elevenlabs",
          tone: "warm",
          pace: "moderate",
          sampleUrl: "https://example.com/v1.mp3",
        },
        personality: { energy: "conversational", deliveryStyle: "friendly" },
        appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
        environmentSet: ["kitchen", "living_room"],
      };

      const expected = {
        id: "cr_1",
        ...input,
        approved: false,
        isActive: true,
        bibleVersion: "1.0",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.creatorIdentity.create.mockResolvedValue(expected);

      const result = await store.create(input);

      expect(prisma.creatorIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: "Sofia", deploymentId: "dep_1" }),
      });
      expect(result.id).toBe("cr_1");
    });
  });

  describe("findById", () => {
    it("returns creator by id", async () => {
      const creator = { id: "cr_1", name: "Sofia" };
      prisma.creatorIdentity.findUnique.mockResolvedValue(creator);

      const result = await store.findById("cr_1");
      expect(result).toEqual(creator);
    });

    it("returns null when not found", async () => {
      prisma.creatorIdentity.findUnique.mockResolvedValue(null);
      const result = await store.findById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("findByDeployment", () => {
    it("returns active creators for a deployment", async () => {
      const creators = [{ id: "cr_1" }, { id: "cr_2" }];
      prisma.creatorIdentity.findMany.mockResolvedValue(creators);

      const result = await store.findByDeployment("dep_1");

      expect(prisma.creatorIdentity.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1", isActive: true },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates creator fields", async () => {
      const updated = { id: "cr_1", name: "Sofia V2", bibleVersion: "2.0" };
      prisma.creatorIdentity.update.mockResolvedValue(updated);

      const result = await store.update("cr_1", { name: "Sofia V2", bibleVersion: "2.0" });

      expect(prisma.creatorIdentity.update).toHaveBeenCalledWith({
        where: { id: "cr_1" },
        data: { name: "Sofia V2", bibleVersion: "2.0" },
      });
      expect(result.name).toBe("Sofia V2");
    });
  });

  describe("approve", () => {
    it("sets approved to true", async () => {
      prisma.creatorIdentity.update.mockResolvedValue({ id: "cr_1", approved: true });

      const result = await store.approve("cr_1");

      expect(prisma.creatorIdentity.update).toHaveBeenCalledWith({
        where: { id: "cr_1" },
        data: { approved: true },
      });
      expect(result.approved).toBe(true);
    });
  });

  describe("deactivate", () => {
    it("sets isActive to false", async () => {
      prisma.creatorIdentity.update.mockResolvedValue({ id: "cr_1", isActive: false });

      const result = await store.deactivate("cr_1");

      expect(prisma.creatorIdentity.update).toHaveBeenCalledWith({
        where: { id: "cr_1" },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creator-identity-store
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement prisma-creator-identity-store.ts**

```typescript
import type { PrismaDbClient } from "../prisma-db.js";
import type { CreatorIdentity } from "@switchboard/schemas";

interface CreateCreatorIdentityInput {
  deploymentId: string;
  name: string;
  identityRefIds: string[];
  heroImageAssetId: string;
  identityDescription: string;
  identityObjects?: Record<string, string> | null;
  voice: Record<string, unknown>;
  personality: Record<string, unknown>;
  appearanceRules: Record<string, unknown>;
  environmentSet: string[];
}

export class PrismaCreatorIdentityStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateCreatorIdentityInput): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.create({
      data: {
        deploymentId: input.deploymentId,
        name: input.name,
        identityRefIds: input.identityRefIds,
        heroImageAssetId: input.heroImageAssetId,
        identityDescription: input.identityDescription,
        identityObjects: input.identityObjects ? (input.identityObjects as object) : undefined,
        voice: input.voice as object,
        personality: input.personality as object,
        appearanceRules: input.appearanceRules as object,
        environmentSet: input.environmentSet,
      },
    }) as unknown as CreatorIdentity;
  }

  async findById(id: string): Promise<CreatorIdentity | null> {
    return this.prisma.creatorIdentity.findUnique({
      where: { id },
    }) as unknown as CreatorIdentity | null;
  }

  async findByDeployment(deploymentId: string): Promise<CreatorIdentity[]> {
    return this.prisma.creatorIdentity.findMany({
      where: { deploymentId, isActive: true },
      orderBy: { createdAt: "desc" },
    }) as unknown as CreatorIdentity[];
  }

  async update(
    id: string,
    data: Partial<Omit<CreatorIdentity, "id" | "createdAt" | "updatedAt">>,
  ): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: data as never,
    }) as unknown as CreatorIdentity;
  }

  async approve(id: string): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: { approved: true },
    }) as unknown as CreatorIdentity;
  }

  async deactivate(id: string): Promise<CreatorIdentity> {
    return this.prisma.creatorIdentity.update({
      where: { id },
      data: { isActive: false },
    }) as unknown as CreatorIdentity;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creator-identity-store
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-creator-identity-store.ts packages/db/src/stores/__tests__/prisma-creator-identity-store.test.ts
git commit -m "feat(db): add PrismaCreatorIdentityStore with CRUD + approve/deactivate"
```

---

## Task 8: Asset Record Store

**Files:**

- Create: `packages/db/src/stores/prisma-asset-record-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-asset-record-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/db/src/stores/__tests__/prisma-asset-record-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAssetRecordStore } from "../prisma-asset-record-store.js";

function createMockPrisma() {
  return {
    assetRecord: {
      create: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaAssetRecordStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAssetRecordStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAssetRecordStore(prisma as never);
  });

  describe("upsertByKey", () => {
    it("upserts asset by specId + attemptNumber + provider", async () => {
      const input = {
        jobId: "job_1",
        specId: "spec_1",
        creatorId: "cr_1",
        provider: "kling",
        modelId: "kling-v1",
        attemptNumber: 1,
        inputHashes: { referencesHash: "abc", promptHash: "def" },
        outputs: { videoUrl: "https://cdn.example.com/v.mp4", checksums: {} },
        approvalState: "pending" as const,
      };

      const expected = { id: "ar_1", ...input, createdAt: new Date() };
      prisma.assetRecord.upsert.mockResolvedValue(expected);

      const result = await store.upsertByKey(input);

      expect(prisma.assetRecord.upsert).toHaveBeenCalledWith({
        where: {
          specId_attemptNumber_provider: {
            specId: "spec_1",
            attemptNumber: 1,
            provider: "kling",
          },
        },
        create: expect.objectContaining({ jobId: "job_1", specId: "spec_1" }),
        update: expect.objectContaining({ outputs: input.outputs }),
      });
      expect(result.id).toBe("ar_1");
    });
  });

  describe("findByJob", () => {
    it("returns assets for a job", async () => {
      const assets = [{ id: "ar_1" }, { id: "ar_2" }];
      prisma.assetRecord.findMany.mockResolvedValue(assets);

      const result = await store.findByJob("job_1");

      expect(prisma.assetRecord.findMany).toHaveBeenCalledWith({
        where: { jobId: "job_1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("findBySpec", () => {
    it("returns assets for a spec", async () => {
      prisma.assetRecord.findMany.mockResolvedValue([{ id: "ar_1" }]);

      const result = await store.findBySpec("spec_1");

      expect(prisma.assetRecord.findMany).toHaveBeenCalledWith({
        where: { specId: "spec_1" },
        orderBy: { attemptNumber: "asc" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("findLockedByCreator", () => {
    it("returns the most recent locked asset for a creator", async () => {
      const asset = { id: "ar_1", approvalState: "locked" };
      prisma.assetRecord.findMany.mockResolvedValue([asset]);

      const result = await store.findLockedByCreator("cr_1");

      expect(prisma.assetRecord.findMany).toHaveBeenCalledWith({
        where: { creatorId: "cr_1", approvalState: "locked" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(result).toEqual(asset);
    });

    it("returns null when no locked asset exists", async () => {
      prisma.assetRecord.findMany.mockResolvedValue([]);

      const result = await store.findLockedByCreator("cr_1");

      expect(result).toBeNull();
    });
  });

  describe("updateApprovalState", () => {
    it("updates approval state", async () => {
      prisma.assetRecord.update.mockResolvedValue({ id: "ar_1", approvalState: "approved" });

      const result = await store.updateApprovalState("ar_1", "approved");

      expect(prisma.assetRecord.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: { approvalState: "approved" },
      });
      expect(result.approvalState).toBe("approved");
    });
  });

  describe("updateQaMetrics", () => {
    it("updates QA metrics and history", async () => {
      const metrics = {
        hardChecks: { artifactFlags: [] },
        softScores: {},
        overallDecision: "pass",
      };
      const history = [{ attempt: 1, provider: "kling", score: metrics }];
      prisma.assetRecord.update.mockResolvedValue({
        id: "ar_1",
        qaMetrics: metrics,
        qaHistory: history,
      });

      const result = await store.updateQaMetrics("ar_1", metrics, history);

      expect(prisma.assetRecord.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: { qaMetrics: metrics, qaHistory: history },
      });
      expect(result.qaMetrics).toEqual(metrics);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-asset-record-store
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement prisma-asset-record-store.ts**

```typescript
import type { PrismaDbClient } from "../prisma-db.js";
import type { AssetRecord } from "@switchboard/schemas";

interface UpsertAssetInput {
  jobId: string;
  specId: string;
  creatorId?: string | null;
  provider: string;
  modelId: string;
  modelVersion?: string | null;
  seed?: number | null;
  attemptNumber: number;
  inputHashes: Record<string, unknown>;
  outputs: Record<string, unknown>;
  qaMetrics?: Record<string, unknown> | null;
  qaHistory?: Record<string, unknown>[] | null;
  identityDriftScore?: number | null;
  baselineAssetId?: string | null;
  latencyMs?: number | null;
  costEstimate?: number | null;
  approvalState: string;
  lockedDerivativeOf?: string | null;
}

export class PrismaAssetRecordStore {
  constructor(private prisma: PrismaDbClient) {}

  async upsertByKey(input: UpsertAssetInput): Promise<AssetRecord> {
    const data = {
      jobId: input.jobId,
      specId: input.specId,
      creatorId: input.creatorId ?? null,
      provider: input.provider,
      modelId: input.modelId,
      modelVersion: input.modelVersion ?? null,
      seed: input.seed ?? null,
      attemptNumber: input.attemptNumber,
      inputHashes: input.inputHashes as object,
      outputs: input.outputs as object,
      qaMetrics: input.qaMetrics ? (input.qaMetrics as object) : undefined,
      qaHistory: input.qaHistory ? (input.qaHistory as object) : undefined,
      identityDriftScore: input.identityDriftScore ?? null,
      baselineAssetId: input.baselineAssetId ?? null,
      latencyMs: input.latencyMs ?? null,
      costEstimate: input.costEstimate ?? null,
      approvalState: input.approvalState,
      lockedDerivativeOf: input.lockedDerivativeOf ?? null,
    };

    return this.prisma.assetRecord.upsert({
      where: {
        specId_attemptNumber_provider: {
          specId: input.specId,
          attemptNumber: input.attemptNumber,
          provider: input.provider,
        },
      },
      create: data,
      update: {
        outputs: data.outputs,
        qaMetrics: data.qaMetrics,
        qaHistory: data.qaHistory,
        identityDriftScore: data.identityDriftScore,
        latencyMs: data.latencyMs,
        costEstimate: data.costEstimate,
        approvalState: data.approvalState,
      },
    }) as unknown as AssetRecord;
  }

  async findById(id: string): Promise<AssetRecord | null> {
    return this.prisma.assetRecord.findUnique({
      where: { id },
    }) as unknown as AssetRecord | null;
  }

  async findByJob(jobId: string): Promise<AssetRecord[]> {
    return this.prisma.assetRecord.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
    }) as unknown as AssetRecord[];
  }

  async findBySpec(specId: string): Promise<AssetRecord[]> {
    return this.prisma.assetRecord.findMany({
      where: { specId },
      orderBy: { attemptNumber: "asc" },
    }) as unknown as AssetRecord[];
  }

  async findLockedByCreator(creatorId: string): Promise<AssetRecord | null> {
    const results = await this.prisma.assetRecord.findMany({
      where: { creatorId, approvalState: "locked" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    return (results[0] as unknown as AssetRecord) ?? null;
  }

  async updateApprovalState(id: string, state: string): Promise<AssetRecord> {
    return this.prisma.assetRecord.update({
      where: { id },
      data: { approvalState: state },
    }) as unknown as AssetRecord;
  }

  async updateQaMetrics(
    id: string,
    metrics: Record<string, unknown>,
    history: Record<string, unknown>[],
  ): Promise<AssetRecord> {
    return this.prisma.assetRecord.update({
      where: { id },
      data: {
        qaMetrics: metrics as object,
        qaHistory: history as object,
      },
    }) as unknown as AssetRecord;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-asset-record-store
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-asset-record-store.ts packages/db/src/stores/__tests__/prisma-asset-record-store.test.ts
git commit -m "feat(db): add PrismaAssetRecordStore with idempotent upsert and QA methods"
```

---

## Task 9: DB Barrel Exports

**Files:**

- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add exports for new stores**

Add at the end of `packages/db/src/index.ts`:

```typescript
export { PrismaCreatorIdentityStore } from "./stores/prisma-creator-identity-store.js";
export { PrismaAssetRecordStore } from "./stores/prisma-asset-record-store.js";
```

- [ ] **Step 2: Build db package to verify exports**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/index.ts
git commit -m "feat(db): export CreatorIdentity and AssetRecord stores from barrel"
```

---

## Task 10: API Route — Accept mode on Job Submission

**Files:**

- Modify: `apps/api/src/routes/creative-pipeline.ts`

- [ ] **Step 1: Update SubmitBriefInput to accept mode**

In `apps/api/src/routes/creative-pipeline.ts`, update the `SubmitBriefInput` schema:

```typescript
const SubmitBriefInput = z.object({
  deploymentId: z.string().min(1),
  listingId: z.string().min(1),
  brief: CreativeBriefInput,
  mode: z.enum(["polished", "ugc"]).default("polished"),
});
```

- [ ] **Step 2: Update the POST handler to pass mode through**

In the POST `/creative-jobs` handler, after `const { deploymentId, listingId, brief } = parsed.data;`, destructure `mode`:

```typescript
const { deploymentId, listingId, brief, mode } = parsed.data;
```

Update the job creation to branch on mode:

```typescript
const jobStore = new PrismaCreativeJobStore(app.prisma);
const job =
  mode === "ugc"
    ? await jobStore.createUgc({
        taskId: task.id,
        organizationId: orgId,
        deploymentId,
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        platforms: brief.platforms,
        brandVoice: brief.brandVoice ?? null,
        productImages: brief.productImages,
        references: brief.references,
        pastPerformance: brief.pastPerformance ?? null,
        generateReferenceImages: brief.generateReferenceImages,
        ugcConfig: brief as unknown as Record<string, unknown>,
      })
    : await jobStore.create({
        taskId: task.id,
        organizationId: orgId,
        deploymentId,
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        platforms: brief.platforms,
        brandVoice: brief.brandVoice ?? null,
        productImages: brief.productImages,
        references: brief.references,
        pastPerformance: brief.pastPerformance ?? null,
        generateReferenceImages: brief.generateReferenceImages,
      });
```

Update the Inngest event to include mode:

```typescript
await inngestClient.send({
  name: "creative-pipeline/job.submitted",
  data: {
    jobId: job.id,
    taskId: task.id,
    organizationId: orgId,
    deploymentId,
    mode,
  },
});
```

- [ ] **Step 3: Update the approve endpoint to handle UGC phase approvals**

In the POST `/creative-jobs/:id/approve` handler, add UGC-aware approval logic. After the existing `stoppedAt` check:

```typescript
// UGC mode: emit phase-specific approval event
if (job.mode === "ugc") {
  if (parsed.data.action === "stop") {
    await inngestClient.send({
      name: "creative-pipeline/ugc-phase.approved",
      data: { jobId: id, phase: job.ugcPhase, action: "stop" },
    });
    return reply.send({ job, action: "stopped" });
  }

  await inngestClient.send({
    name: "creative-pipeline/ugc-phase.approved",
    data: { jobId: id, phase: job.ugcPhase, action: "continue" },
  });
  return reply.send({ job, action: "approved" });
}
```

This block goes right after the `if (job.currentStage === "complete" || job.stoppedAt)` guard, before the existing polished-mode approval logic.

- [ ] **Step 4: Add `mode` and `ugcPhase` property access**

The `job` object returned from `findById` needs `mode` and `ugcPhase`. These are already on the Prisma model after the migration, and the `CreativeJobSchema` was extended in Task 4. The route accesses them as `job.mode` and `job.ugcPhase` — TypeScript will resolve these through the `CreativeJob` type.

Verify by running typecheck:

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/creative-pipeline.ts
git commit -m "feat(api): accept mode on creative job submission, route UGC approvals"
```

---

## Task 11: Full Build + Test Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test
```

Expected: All tests pass. No regressions in existing creative pipeline tests.

- [ ] **Step 2: Run full typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint
```

Expected: No lint errors.

- [ ] **Step 4: Fix any issues, commit if needed**

If any step fails, fix the issue and create a new commit:

```bash
git commit -m "fix: resolve SP1 lint/type/test issues"
```
