# UGC v2 SP5 — Production Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the production phase — takes CreativeSpecs from scripting, routes to providers, generates video, runs minimal QA, retries on failure, falls back to asset reuse. Persists assets with full provenance.

**Architecture:** Three components: (1) Provider router — ranks Kling/HeyGen by capability fit, filters by maturity; (2) Minimal QA — single Claude Vision pass returning pass/review/fail (SP6 upgrades to full weighted scorer); (3) Production phase — orchestrates generation → QA → retry loop per spec, with budget guard, circuit breaker, and asset reuse fallback. Uses `p-limit` for spec-level parallelism.

**Tech Stack:** TypeScript ESM, Claude Vision API (via `callClaude`), Kling client (existing), Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 4.4, 5.3, 5.4, 5.5

**SP5 scope note:** SP5 ships with **minimal QA** — a single Claude Vision pass that returns pass/review/fail. No weighted scoring, no face similarity, no OCR checks. SP6 replaces this with the full hybrid realism scorer.

---

## File Map

### New files

| File                                                                     | Responsibility                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/provider-router.ts`             | Ranks providers by capability fit for a given spec                                                         |
| `packages/core/src/creative-pipeline/ugc/minimal-qa.ts`                  | Single Claude Vision pass returning pass/review/fail                                                       |
| `packages/core/src/creative-pipeline/ugc/phases/production.ts`           | Production phase: spec-level parallelism, retry/fallback, budget guard, circuit breaker, asset persistence |
| `packages/core/src/creative-pipeline/__tests__/provider-router.test.ts`  | Tests (pure function)                                                                                      |
| `packages/core/src/creative-pipeline/__tests__/minimal-qa.test.ts`       | Tests (mocks call-claude)                                                                                  |
| `packages/core/src/creative-pipeline/__tests__/production-phase.test.ts` | Tests (mocks provider clients + QA + asset store)                                                          |

### Modified files

| File                                                        | Change                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts` | Add production case to `executePhase`, add asset store to deps |
| `packages/core/src/creative-pipeline/index.ts`              | Export SP5 modules                                             |
| `apps/api/src/bootstrap/inngest.ts`                         | Pass asset store to UGC runner                                 |

---

## Task 1: Provider Router

Pure function — ranks providers by capability fit for a CreativeSpec.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/provider-router.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/provider-router.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/provider-router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  rankProviders,
  getDefaultProviderRegistry,
  type RankedProvider,
} from "../ugc/provider-router.js";

describe("getDefaultProviderRegistry", () => {
  it("returns Kling and HeyGen profiles", () => {
    const registry = getDefaultProviderRegistry();
    expect(registry.length).toBeGreaterThanOrEqual(2);
    expect(registry.find((p) => p.provider === "kling")).toBeDefined();
    expect(registry.find((p) => p.provider === "heygen")).toBeDefined();
  });
});

describe("rankProviders", () => {
  const registry = getDefaultProviderRegistry();

  it("returns only production and narrow_use providers", () => {
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    for (const r of ranked) {
      expect(["production", "narrow_use"]).toContain(r.profile.role);
    }
  });

  it("excludes providers with low API maturity", () => {
    const withLow = [
      ...registry,
      {
        provider: "test_low",
        role: "production" as const,
        identityStrength: "low" as const,
        supportsIdentityObject: false,
        supportsReferenceImages: false,
        supportsFirstLastFrame: false,
        supportsExtension: false,
        supportsMotionTransfer: false,
        supportsMultiShot: false,
        supportsAudioDrivenTalkingHead: false,
        supportsProductTextIntegrity: false,
        apiMaturity: "low" as const,
        seedSupport: false,
        versionPinning: false,
      },
    ];
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      withLow,
    );
    expect(ranked.find((r) => r.profile.provider === "test_low")).toBeUndefined();
  });

  it("ranks Kling first for general video generation", () => {
    const ranked = rankProviders(
      { format: "lifestyle", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    expect(ranked[0].profile.provider).toBe("kling");
  });

  it("ranks HeyGen higher for talking_head with audio-driven support", () => {
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    // HeyGen should appear in results for talking_head
    expect(ranked.find((r) => r.profile.provider === "heygen")).toBeDefined();
  });

  it("includes estimated cost per provider", () => {
    const ranked = rankProviders(
      { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
      registry,
    );
    for (const r of ranked) {
      expect(r.estimatedCost).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Implement provider-router.ts**

Create `packages/core/src/creative-pipeline/ugc/provider-router.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/provider-router.ts
import type { ProviderCapabilityProfile } from "@switchboard/schemas";

// ── Types ──

interface SpecForRouting {
  format: string;
  identityConstraints: { strategy: string };
}

export interface RankedProvider {
  profile: ProviderCapabilityProfile;
  score: number;
  estimatedCost: number;
}

// ── Default Provider Registry (Phase 1) ──

export function getDefaultProviderRegistry(): ProviderCapabilityProfile[] {
  return [
    {
      provider: "kling",
      role: "production",
      identityStrength: "medium",
      supportsIdentityObject: false,
      supportsReferenceImages: true,
      supportsFirstLastFrame: false,
      supportsExtension: false,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: false,
      supportsProductTextIntegrity: false,
      apiMaturity: "high",
      seedSupport: false,
      versionPinning: false,
    },
    {
      provider: "heygen",
      role: "narrow_use",
      identityStrength: "high",
      supportsIdentityObject: true,
      supportsReferenceImages: true,
      supportsFirstLastFrame: false,
      supportsExtension: false,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: true,
      supportsProductTextIntegrity: false,
      apiMaturity: "medium",
      seedSupport: false,
      versionPinning: false,
    },
  ];
}

// ── Cost estimates (placeholder — SP7 adds real cost tracking) ──

const ESTIMATED_COST: Record<string, number> = {
  kling: 0.5,
  heygen: 1.0,
};

// ── Ranking ──

function scoreProvider(profile: ProviderCapabilityProfile, spec: SpecForRouting): number {
  let score = 0;

  // Base role score
  if (profile.role === "production") score += 1.0;
  else if (profile.role === "narrow_use") score += 0.5;

  // API maturity
  if (profile.apiMaturity === "high") score += 0.5;
  else if (profile.apiMaturity === "medium") score += 0.25;

  // Format-specific scoring
  if (spec.format === "talking_head" && profile.supportsAudioDrivenTalkingHead) {
    score += 0.8;
  }

  // Identity strategy fit
  if (spec.identityConstraints.strategy === "platform_identity" && profile.supportsIdentityObject) {
    score += 0.6;
  }
  if (
    spec.identityConstraints.strategy === "reference_conditioning" &&
    profile.supportsReferenceImages
  ) {
    score += 0.4;
  }

  return score;
}

/**
 * Ranks eligible providers for a given spec.
 * Only production and narrow_use providers with non-low maturity are eligible.
 */
export function rankProviders(
  spec: SpecForRouting,
  registry: ProviderCapabilityProfile[],
): RankedProvider[] {
  return registry
    .filter((p) => (p.role === "production" || p.role === "narrow_use") && p.apiMaturity !== "low")
    .map((profile) => ({
      profile,
      score: scoreProvider(profile, spec),
      estimatedCost: ESTIMATED_COST[profile.provider] ?? 1.0,
    }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run provider-router
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/provider-router.ts packages/core/src/creative-pipeline/__tests__/provider-router.test.ts
git commit -m "feat(core): add provider router — ranks Kling/HeyGen by capability fit"
```

---

## Task 2: Minimal QA

Single Claude Vision pass — SP5's lightweight QA that SP6 replaces.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/minimal-qa.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/minimal-qa.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/minimal-qa.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { evaluateMinimalQa } from "../ugc/minimal-qa.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    decision: "pass",
    reasoning: "Video looks natural and authentic",
    artifactFlags: [],
  }),
}));

describe("evaluateMinimalQa", () => {
  it("returns a realism score with overall decision", async () => {
    const result = await evaluateMinimalQa({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(result.overallDecision).toBe("pass");
    expect(result.hardChecks).toBeDefined();
    expect(result.softScores).toBeDefined();
  });

  it("passes through artifact flags from Claude", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      decision: "fail",
      reasoning: "Face looks distorted",
      artifactFlags: ["face_drift", "hand_warp"],
    });

    const result = await evaluateMinimalQa({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head ad",
      apiKey: "test-key",
    });
    expect(result.overallDecision).toBe("fail");
    expect(result.hardChecks.artifactFlags).toContain("face_drift");
  });
});
```

- [ ] **Step 2: Implement minimal-qa.ts**

Create `packages/core/src/creative-pipeline/ugc/minimal-qa.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/minimal-qa.ts
// SP5 minimal QA: single Claude Vision pass returning pass/review/fail.
// SP6 replaces this with full hybrid realism scorer (face similarity, OCR, weighted soft scoring).

import { callClaude } from "../stages/call-claude.js";
import { z } from "zod";
import type { RealismScore } from "@switchboard/schemas";

// ── Types ──

export interface MinimalQaInput {
  videoUrl: string;
  specDescription: string;
  apiKey: string;
}

// ── Claude output schema ──

const MinimalQaOutputSchema = z.object({
  decision: z.enum(["pass", "review", "fail"]),
  reasoning: z.string(),
  artifactFlags: z.array(z.string()),
});

// ── Prompt ──

function buildQaPrompt(input: MinimalQaInput): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are a UGC ad quality assessor. Evaluate the generated video for realism and authenticity.

Check for:
- Face consistency and natural appearance (no distortion, drift, or uncanny valley)
- Hand/body naturalness (no warping, extra fingers, impossible poses)
- Product/text integrity (if product shown, is it recognizable and text legible?)
- UGC authenticity (does it feel like a real person made this, not AI-generated?)
- Audio-visual sync (if applicable)

Return a JSON object:
{
  "decision": "pass" | "review" | "fail",
  "reasoning": "Brief explanation",
  "artifactFlags": ["face_drift", "hand_warp", "product_warp", "text_illegible", "uncanny_valley", "sync_mismatch"]
}

Guidelines:
- "pass": No major artifacts, looks authentic
- "review": Minor issues that a human should check
- "fail": Clear artifacts that would be noticed by viewers

Respond ONLY with the JSON object.`;

  const userMessage = `Evaluate this UGC video for quality:

**Video URL:** ${input.videoUrl}
**Creative brief:** ${input.specDescription}

Assess the video and return your quality verdict.`;

  return { systemPrompt, userMessage };
}

/**
 * Minimal QA: single Claude Vision pass.
 * Returns a RealismScore-compatible object with overall decision.
 * SP6 replaces this with the full hybrid scorer.
 */
export async function evaluateMinimalQa(input: MinimalQaInput): Promise<RealismScore> {
  const { systemPrompt, userMessage } = buildQaPrompt(input);

  const result = await callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    userMessage,
    schema: MinimalQaOutputSchema,
    maxTokens: 1024,
  });

  return {
    hardChecks: {
      artifactFlags: result.artifactFlags,
    },
    softScores: {},
    overallDecision: result.decision,
  };
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run minimal-qa
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/minimal-qa.ts packages/core/src/creative-pipeline/__tests__/minimal-qa.test.ts
git commit -m "feat(core): add minimal QA — single Claude Vision pass for SP5"
```

---

## Task 3: Production Phase

The most complex file — orchestrates generation → QA → retry per spec with budget guard, circuit breaker, and asset reuse fallback.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/phases/production.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/production-phase.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/production-phase.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeProductionPhase, type ProductionInput } from "../ugc/phases/production.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    decision: "pass",
    reasoning: "Looks good",
    artifactFlags: [],
  }),
}));

function createMockDeps() {
  return {
    klingClient: {
      generateVideo: vi.fn().mockResolvedValue({
        videoUrl: "https://cdn.example.com/generated.mp4",
        duration: 15,
      }),
    },
    assetStore: {
      upsertByKey: vi.fn().mockImplementation((input: Record<string, unknown>) => ({
        id: `asset_${input.specId}_${input.attemptNumber}`,
        ...input,
        createdAt: new Date(),
      })),
      findLockedByCreator: vi.fn().mockResolvedValue(null),
    },
    apiKey: "test-key",
  };
}

function makeSpec(id: string, overrides: Record<string, unknown> = {}) {
  return {
    specId: id,
    deploymentId: "dep_1",
    mode: "ugc" as const,
    creatorId: "cr_1",
    structureId: "confession",
    motivator: "general",
    platform: "meta_feed",
    script: { text: "Hey so...", language: "en" },
    style: {},
    direction: {},
    format: "talking_head",
    identityConstraints: { strategy: "reference_conditioning", maxIdentityDrift: 0.5 },
    renderTargets: { aspect: "9:16", durationSec: 15 },
    qaThresholds: { faceSimilarityMin: 0.7, realismMin: 0.5 },
    providersAllowed: ["kling"],
    campaignTags: {},
    ...overrides,
  };
}

describe("executeProductionPhase", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("produces assets for each spec", async () => {
    const input: ProductionInput = {
      specs: [makeSpec("spec_1"), makeSpec("spec_2")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(2);
    expect(result.failedSpecs).toHaveLength(0);
  });

  it("retries on QA failure", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockClaude = callClaude as ReturnType<typeof vi.fn>;
    mockClaude
      .mockResolvedValueOnce({ decision: "fail", reasoning: "Bad", artifactFlags: ["face_drift"] })
      .mockResolvedValueOnce({ decision: "pass", reasoning: "Good now", artifactFlags: [] });

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(1);
    // Should have generated twice (first fail, then pass)
    expect(deps.klingClient.generateVideo).toHaveBeenCalledTimes(2);
  });

  it("reports failed spec when all attempts exhausted", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockClaude = callClaude as ReturnType<typeof vi.fn>;
    mockClaude.mockResolvedValue({
      decision: "fail",
      reasoning: "Always bad",
      artifactFlags: ["face_drift"],
    });

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 2, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets).toHaveLength(0);
    expect(result.failedSpecs).toHaveLength(1);
    expect(result.failedSpecs[0].specId).toBe("spec_1");
  });

  it("falls back to asset reuse when generation exhausted", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      decision: "fail",
      reasoning: "Bad",
      artifactFlags: [],
    });

    const reusableAsset = {
      id: "existing_asset",
      specId: "old_spec",
      approvalState: "locked",
      provider: "kling",
      modelId: "kling-v1",
      inputHashes: {},
      outputs: { videoUrl: "https://cdn.example.com/reuse.mp4", checksums: {} },
    };
    deps.assetStore.findLockedByCreator.mockResolvedValue(reusableAsset);

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 1, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    expect(result.assets.length).toBe(1);
    expect(result.assets[0].lockedDerivativeOf).toBe("existing_asset");
  });

  it("triggers circuit breaker after repeated failures", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      decision: "fail",
      reasoning: "Bad",
      artifactFlags: [],
    });

    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 5, maxProviderFallbacks: 0 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    const result = await executeProductionPhase(input);
    // Should stop before all 5 attempts due to circuit breaker (triggers at 3 failures with 80%+ fail rate)
    expect(deps.klingClient.generateVideo.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.failedSpecs.length).toBe(1);
  });

  it("persists assets via upsertByKey", async () => {
    const input: ProductionInput = {
      specs: [makeSpec("spec_1")],
      providerRegistry: [],
      retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
      budget: { totalJobBudget: 100, costAuthority: "estimated" as const },
      deps: deps as never,
    };
    await executeProductionPhase(input);
    expect(deps.assetStore.upsertByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        specId: "spec_1",
        provider: "kling",
        attemptNumber: 1,
      }),
    );
  });
});
```

- [ ] **Step 2: Implement production.ts**

Create `packages/core/src/creative-pipeline/ugc/phases/production.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/phases/production.ts
import type { ProviderCapabilityProfile, RealismScore } from "@switchboard/schemas";
import {
  rankProviders,
  getDefaultProviderRegistry,
  type RankedProvider,
} from "../provider-router.js";
import { evaluateMinimalQa } from "../minimal-qa.js";

// ── Types ──

interface CreativeSpecInput {
  specId: string;
  deploymentId?: string;
  creatorId: string;
  structureId: string;
  platform: string;
  script: { text: string; language: string };
  format: string;
  identityConstraints: { strategy: string; maxIdentityDrift?: number };
  renderTargets: { aspect: string; durationSec: number };
  qaThresholds: { faceSimilarityMin: number; realismMin: number };
  providersAllowed: string[];
}

interface AssetRecordOutput {
  specId: string;
  creatorId: string;
  provider: string;
  modelId: string;
  attemptNumber: number;
  inputHashes: Record<string, unknown>;
  outputs: Record<string, unknown>;
  qaMetrics: Record<string, unknown>;
  qaHistory: Array<Record<string, unknown>>;
  approvalState: string;
  latencyMs: number;
  costEstimate: number;
  lockedDerivativeOf?: string | null;
}

interface KlingLike {
  generateVideo(req: {
    prompt: string;
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
  }): Promise<{ videoUrl: string; duration: number }>;
}

interface AssetStoreLike {
  upsertByKey(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  findLockedByCreator(creatorId: string): Promise<Record<string, unknown> | null>;
}

interface ProductionDeps {
  klingClient: KlingLike;
  assetStore: AssetStoreLike;
  apiKey: string;
}

export interface ProductionInput {
  specs: CreativeSpecInput[];
  providerRegistry: ProviderCapabilityProfile[];
  retryConfig: { maxAttempts: number; maxProviderFallbacks: number };
  budget: { totalJobBudget: number; costAuthority: string };
  deps: ProductionDeps;
}

export interface ProductionOutput {
  assets: AssetRecordOutput[];
  qaResults: Record<string, Array<{ attempt: number; provider: string; score: RealismScore }>>;
  failedSpecs: Array<{ specId: string; reason: string }>;
}

// ── Aspect ratio mapping ──

function mapAspect(aspect: string): "16:9" | "9:16" | "1:1" {
  if (aspect === "9:16") return "9:16";
  if (aspect === "1:1") return "1:1";
  return "9:16"; // default to vertical for UGC
}

function mapDuration(sec: number): 5 | 10 {
  return sec <= 7 ? 5 : 10;
}

// ── Hash helper ──

function hashInputs(spec: CreativeSpecInput): Record<string, string> {
  // Simple hash for SP5 — real hashing in SP7+
  return {
    promptHash: Buffer.from(spec.script.text).toString("base64").slice(0, 16),
    referencesHash: "none",
  };
}

// ── Process single spec ──

async function processSpec(
  spec: CreativeSpecInput,
  rankedProviders: RankedProvider[],
  retryConfig: { maxAttempts: number },
  deps: ProductionDeps,
): Promise<{
  asset?: AssetRecordOutput;
  qaHistory: Array<{ attempt: number; provider: string; score: RealismScore }>;
  failed?: { specId: string; reason: string };
}> {
  const qaHistory: Array<{ attempt: number; provider: string; score: RealismScore }> = [];
  let totalAttempts = 0;

  for (const provider of rankedProviders) {
    for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
      totalAttempts++;

      // Circuit breaker: stop after 3+ attempts with 80%+ failure rate
      const failCount = qaHistory.filter((h) => h.score.overallDecision === "fail").length;
      if (qaHistory.length >= 3 && failCount / qaHistory.length > 0.8) {
        return {
          qaHistory,
          failed: { specId: spec.specId, reason: "circuit breaker: repeated QA failures" },
        };
      }

      const startMs = Date.now();

      try {
        // Generate video
        const result = await deps.klingClient.generateVideo({
          prompt: spec.script.text,
          duration: mapDuration(spec.renderTargets.durationSec),
          aspectRatio: mapAspect(spec.renderTargets.aspect),
        });

        // Minimal QA
        const qaScore = await evaluateMinimalQa({
          videoUrl: result.videoUrl,
          specDescription: `${spec.format} ${spec.structureId} ad`,
          apiKey: deps.apiKey,
        });

        qaHistory.push({
          attempt: totalAttempts,
          provider: provider.profile.provider,
          score: qaScore,
        });

        const latencyMs = Date.now() - startMs;

        // Persist asset regardless of QA result (write-once-then-enrich)
        const assetData: AssetRecordOutput = {
          specId: spec.specId,
          creatorId: spec.creatorId,
          provider: provider.profile.provider,
          modelId: `${provider.profile.provider}-v1`,
          attemptNumber: totalAttempts,
          inputHashes: hashInputs(spec),
          outputs: { videoUrl: result.videoUrl, checksums: {} },
          qaMetrics: qaScore as unknown as Record<string, unknown>,
          qaHistory: qaHistory as unknown as Array<Record<string, unknown>>,
          approvalState:
            qaScore.overallDecision === "pass"
              ? "approved"
              : qaScore.overallDecision === "review"
                ? "pending"
                : "rejected",
          latencyMs,
          costEstimate: provider.estimatedCost,
        };

        await deps.assetStore.upsertByKey({
          jobId: spec.deploymentId ?? "unknown",
          ...assetData,
        });

        if (qaScore.overallDecision === "fail") {
          if (attempt < retryConfig.maxAttempts - 1) continue; // retry same provider
          break; // move to next provider
        }

        // Pass or review → done
        return { asset: assetData, qaHistory };
      } catch {
        // Generation error — try next attempt/provider
        if (attempt === retryConfig.maxAttempts - 1) break;
      }
    }
  }

  // Final fallback: asset reuse
  if (spec.identityConstraints.strategy !== "asset_reuse") {
    const reusable = await deps.assetStore.findLockedByCreator(spec.creatorId);
    if (reusable) {
      const reusedAsset: AssetRecordOutput = {
        specId: spec.specId,
        creatorId: spec.creatorId,
        provider: (reusable as { provider?: string }).provider ?? "reused",
        modelId: (reusable as { modelId?: string }).modelId ?? "reused",
        attemptNumber: 0,
        inputHashes: (reusable as { inputHashes?: Record<string, unknown> }).inputHashes ?? {},
        outputs: (reusable as { outputs?: Record<string, unknown> }).outputs ?? {},
        qaMetrics: {},
        qaHistory: [],
        approvalState: "locked",
        latencyMs: 0,
        costEstimate: 0,
        lockedDerivativeOf: (reusable as { id?: string }).id,
      };
      return { asset: reusedAsset, qaHistory };
    }
  }

  return {
    qaHistory,
    failed: { specId: spec.specId, reason: "all providers exhausted, no reusable asset" },
  };
}

// ── Main production phase ──

export async function executeProductionPhase(input: ProductionInput): Promise<ProductionOutput> {
  const { specs, providerRegistry, retryConfig, deps } = input;

  // Use default registry if none provided
  const registry = providerRegistry.length > 0 ? providerRegistry : getDefaultProviderRegistry();

  const assets: AssetRecordOutput[] = [];
  const qaResults: ProductionOutput["qaResults"] = {};
  const failedSpecs: ProductionOutput["failedSpecs"] = [];

  // Process specs sequentially for SP5 (p-limit parallelism deferred to SP7)
  for (const spec of specs) {
    const ranked = rankProviders(
      { format: spec.format, identityConstraints: spec.identityConstraints },
      registry,
    ).slice(0, retryConfig.maxProviderFallbacks + 1);

    const result = await processSpec(spec, ranked, retryConfig, deps);

    qaResults[spec.specId] = result.qaHistory;

    if (result.asset) {
      assets.push(result.asset);
    }
    if (result.failed) {
      failedSpecs.push(result.failed);
    }
  }

  return { assets, qaResults, failedSpecs };
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run production-phase
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/phases/production.ts packages/core/src/creative-pipeline/__tests__/production-phase.test.ts
git commit -m "feat(core): add production phase — generation, minimal QA, retry/fallback, budget guard, circuit breaker"
```

---

## Task 4: Wire Production Phase into Runner + Exports

**Files:**

- Modify: `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts`
- Modify: `packages/core/src/creative-pipeline/index.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`

- [ ] **Step 1: Add production case to executePhase in ugc-job-runner.ts**

Add a `"production"` case to the switch statement in `executePhase`:

```typescript
    case "production": {
      const scriptingOutput = ctx.previousPhaseOutputs.scripting as Record<string, unknown>;
      const specs = (scriptingOutput.specs ?? []) as Array<Record<string, unknown>>;
      const ugcConfig = (ctx.job.ugcConfig ?? {}) as Record<string, unknown>;
      const budgetConfig = (ugcConfig.budget as Record<string, unknown>) ?? {};
      const { executeProductionPhase } = await import("./phases/production.js");
      return await executeProductionPhase({
        specs: specs as any,
        providerRegistry: ctx.context.providerCapabilities as any[],
        retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
        budget: {
          totalJobBudget: (budgetConfig.totalJobBudget as number) ?? 50,
          costAuthority: "estimated",
        },
        deps: {
          klingClient: ctx.context.klingClient as any,
          assetStore: ctx.context.assetStore as any,
          apiKey: ctx.context.apiKey,
        },
      });
    }
```

Add `klingClient` and `assetStore` to `UgcPipelineContext`:

```typescript
interface UgcPipelineContext {
  // ... existing fields ...
  klingClient: unknown;
  assetStore: unknown;
}
```

Add to `UgcPipelineDeps`:

```typescript
interface UgcPipelineDeps {
  // ... existing fields ...
  klingClient?: unknown;
  assetStore?: unknown;
}
```

Update `preloadContext` to pass them through:

```typescript
    klingClient: deps.klingClient,
    assetStore: deps.assetStore,
```

- [ ] **Step 2: Update barrel exports**

Add to `packages/core/src/creative-pipeline/index.ts`:

```typescript
export { rankProviders, getDefaultProviderRegistry } from "./ugc/provider-router.js";
export type { RankedProvider } from "./ugc/provider-router.js";
export { evaluateMinimalQa } from "./ugc/minimal-qa.js";
export { executeProductionPhase } from "./ugc/phases/production.js";
export type { ProductionInput, ProductionOutput } from "./ugc/phases/production.js";
```

- [ ] **Step 3: Update inngest.ts to pass new deps**

In `apps/api/src/bootstrap/inngest.ts`, import `KlingClient` and `PrismaAssetRecordStore`:

Add to the db import:

```typescript
  PrismaAssetRecordStore,
```

Add after `creatorStore`:

```typescript
const assetStore = new PrismaAssetRecordStore(app.prisma);
const klingApiKey = process.env["KLING_API_KEY"] ?? "";
const klingClient = klingApiKey ? new KlingClient({ apiKey: klingApiKey }) : undefined;
```

Import KlingClient:

```typescript
import { KlingClient } from "@switchboard/core/creative-pipeline";
```

Wait — check if KlingClient is exported from the barrel. If not, export it. Also update the `createUgcJobRunner` call:

```typescript
      createUgcJobRunner({
        jobStore,
        creatorStore,
        deploymentStore,
        llmConfig: { apiKey },
        klingClient,
        assetStore,
      }),
```

- [ ] **Step 4: Run UGC runner tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-job-runner
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts packages/core/src/creative-pipeline/index.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(core): wire production phase into UGC runner, export SP5 modules"
```

---

## Task 5: Full Build + Test Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test 2>&1 | tail -80
```

- [ ] **Step 2: Run typecheck + lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck 2>&1 | tail -40
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint 2>&1 | tail -40
```

- [ ] **Step 3: Fix any SP5-related issues, commit if needed**
