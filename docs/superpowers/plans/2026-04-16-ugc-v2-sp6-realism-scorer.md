# UGC v2 SP6 — Realism Scorer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SP5's minimal QA (single Claude Vision pass) with the full hybrid realism scorer: Claude Vision for face similarity, OCR accuracy, artifact detection, and 4-dimension weighted soft scoring with configurable thresholds.

**Architecture:** One file (`realism-scorer.ts`) replaces `minimal-qa.ts`. It calls Claude Vision twice: once for hard checks (face similarity, OCR, artifacts) and once for soft scores (visual realism, behavioral realism, UGC authenticity, audio naturalness). Thresholds are configurable via `QaThresholdConfig`. The decision logic applies hard check gates first, then weighted soft score threshold.

**Tech Stack:** TypeScript ESM, Claude Vision API (via `callClaude`), Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 4.5, 5.6

---

## File Map

### New files

| File                                                                   | Responsibility                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/realism-scorer.ts`            | Full hybrid realism scorer — hard checks + weighted soft scores + decision logic |
| `packages/core/src/creative-pipeline/__tests__/realism-scorer.test.ts` | Tests for scorer logic + prompt construction                                     |

### Modified files

| File                                                           | Change                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/phases/production.ts` | Import `evaluateRealism` from realism-scorer instead of `evaluateMinimalQa` from minimal-qa |
| `packages/core/src/creative-pipeline/index.ts`                 | Export realism-scorer, remove minimal-qa export                                             |

---

## Task 1: Realism Scorer

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/realism-scorer.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/realism-scorer.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/realism-scorer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  evaluateRealism,
  computeDecision,
  computeWeightedSoftScore,
  DEFAULT_QA_THRESHOLDS,
  type QaThresholdConfig,
} from "../ugc/realism-scorer.js";
import type { RealismScore } from "@switchboard/schemas";

// Mock Claude for the LLM-based scorer
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    faceSimilarity: 0.85,
    ocrAccuracy: 0.9,
    artifactFlags: [],
    visualRealism: 0.8,
    behavioralRealism: 0.75,
    ugcAuthenticity: 0.9,
    audioNaturalness: 0.7,
  }),
}));

describe("computeWeightedSoftScore", () => {
  it("computes weighted average with default weights", () => {
    const score = computeWeightedSoftScore({
      visualRealism: 0.8,
      behavioralRealism: 0.75,
      ugcAuthenticity: 0.9,
      audioNaturalness: 0.7,
    });
    // 0.20*0.8 + 0.20*0.75 + 0.35*0.9 + 0.25*0.7 = 0.16 + 0.15 + 0.315 + 0.175 = 0.8
    expect(score).toBeCloseTo(0.8, 2);
  });

  it("handles missing scores gracefully (treat as 0)", () => {
    const score = computeWeightedSoftScore({});
    expect(score).toBe(0);
  });

  it("handles partial scores", () => {
    const score = computeWeightedSoftScore({ ugcAuthenticity: 1.0 });
    // Only ugcAuthenticity contributes: 0.35 * 1.0 = 0.35
    expect(score).toBeCloseTo(0.35, 2);
  });
});

describe("computeDecision", () => {
  const thresholds = DEFAULT_QA_THRESHOLDS;

  it("returns 'fail' when faceSimilarity below threshold", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.5, artifactFlags: [] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass", // will be overridden
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it("returns 'fail' when ocrAccuracy below threshold", () => {
    const score: RealismScore = {
      hardChecks: { ocrAccuracy: 0.5, artifactFlags: [] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it("returns 'fail' when critical artifact flag present", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: ["face_drift"] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it("returns 'review' when weighted soft score below threshold", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: [] },
      softScores: {
        visualRealism: 0.3,
        behavioralRealism: 0.3,
        ugcAuthenticity: 0.3,
        audioNaturalness: 0.3,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("review");
  });

  it("returns 'pass' when all checks pass", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: [] },
      softScores: {
        visualRealism: 0.8,
        behavioralRealism: 0.8,
        ugcAuthenticity: 0.8,
        audioNaturalness: 0.8,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("pass");
  });

  it("passes when hard check values are missing (not applicable)", () => {
    const score: RealismScore = {
      hardChecks: { artifactFlags: [] },
      softScores: {
        visualRealism: 0.8,
        behavioralRealism: 0.8,
        ugcAuthenticity: 0.8,
        audioNaturalness: 0.8,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("pass");
  });

  it("supports custom thresholds", () => {
    const strict: QaThresholdConfig = {
      ...thresholds,
      hardCheckDefaults: { ...thresholds.hardCheckDefaults, faceSimilarityMin: 0.95 },
    };
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: [] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass",
    };
    // 0.9 < 0.95 threshold → fail
    expect(computeDecision(score, strict)).toBe("fail");
  });
});

describe("evaluateRealism", () => {
  it("calls Claude and returns a complete RealismScore", async () => {
    const result = await evaluateRealism({
      videoUrl: "https://cdn.example.com/video.mp4",
      creatorReferenceUrl: "https://cdn.example.com/ref.jpg",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(result.hardChecks.faceSimilarity).toBeDefined();
    expect(result.hardChecks.artifactFlags).toBeDefined();
    expect(result.softScores.visualRealism).toBeDefined();
    expect(result.softScores.ugcAuthenticity).toBeDefined();
    expect(result.overallDecision).toBeDefined();
    expect(["pass", "review", "fail"]).toContain(result.overallDecision);
  });
});
```

- [ ] **Step 2: Implement realism-scorer.ts**

Create `packages/core/src/creative-pipeline/ugc/realism-scorer.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/realism-scorer.ts
// SP6: Full hybrid realism scorer — replaces SP5's minimal-qa.ts.
// Uses Claude Vision for both hard checks and soft scores.
// SP9 upgrades hard checks to specialized models (ArcFace, SyncNet, etc.).

import { callClaude } from "../stages/call-claude.js";
import { z } from "zod";
import type { RealismScore, RealismSoftScores } from "@switchboard/schemas";

// ── Threshold Config ──

export interface QaThresholdConfig {
  version: string;
  hardCheckDefaults: {
    faceSimilarityMin: number;
    ocrAccuracyMin: number;
    voiceSimilarityMin: number;
    criticalArtifacts: string[];
  };
  softScoreDefaults: {
    reviewThreshold: number;
    weights: {
      visualRealism: number;
      behavioralRealism: number;
      ugcAuthenticity: number;
      audioNaturalness: number;
    };
  };
}

export const DEFAULT_QA_THRESHOLDS: QaThresholdConfig = {
  version: "v1",
  hardCheckDefaults: {
    faceSimilarityMin: 0.7,
    ocrAccuracyMin: 0.8,
    voiceSimilarityMin: 0.75,
    criticalArtifacts: ["face_drift", "product_warp", "hand_warp"],
  },
  softScoreDefaults: {
    reviewThreshold: 0.5,
    weights: {
      visualRealism: 0.2,
      behavioralRealism: 0.2,
      ugcAuthenticity: 0.35,
      audioNaturalness: 0.25,
    },
  },
};

// ── Input ──

export interface RealismScorerInput {
  videoUrl: string;
  creatorReferenceUrl?: string;
  specDescription: string;
  apiKey: string;
  thresholds?: QaThresholdConfig;
}

// ── Claude output schema ──

const ClaudeRealismOutputSchema = z.object({
  faceSimilarity: z.number().min(0).max(1).optional(),
  ocrAccuracy: z.number().min(0).max(1).optional(),
  artifactFlags: z.array(z.string()),
  visualRealism: z.number().min(0).max(1),
  behavioralRealism: z.number().min(0).max(1),
  ugcAuthenticity: z.number().min(0).max(1),
  audioNaturalness: z.number().min(0).max(1),
});

// ── Weighted soft score ──

export function computeWeightedSoftScore(
  softScores: Partial<RealismSoftScores>,
  weights = DEFAULT_QA_THRESHOLDS.softScoreDefaults.weights,
): number {
  return (
    weights.visualRealism * (softScores.visualRealism ?? 0) +
    weights.behavioralRealism * (softScores.behavioralRealism ?? 0) +
    weights.ugcAuthenticity * (softScores.ugcAuthenticity ?? 0) +
    weights.audioNaturalness * (softScores.audioNaturalness ?? 0)
  );
}

// ── Decision logic ──

export function computeDecision(
  score: RealismScore,
  thresholds: QaThresholdConfig = DEFAULT_QA_THRESHOLDS,
): "pass" | "review" | "fail" {
  const { hardCheckDefaults, softScoreDefaults } = thresholds;

  // Hard check gates (fail immediately)
  if (
    score.hardChecks.faceSimilarity !== undefined &&
    score.hardChecks.faceSimilarity < hardCheckDefaults.faceSimilarityMin
  ) {
    return "fail";
  }

  if (
    score.hardChecks.ocrAccuracy !== undefined &&
    score.hardChecks.ocrAccuracy < hardCheckDefaults.ocrAccuracyMin
  ) {
    return "fail";
  }

  // Critical artifact flags
  const hasCriticalArtifact = score.hardChecks.artifactFlags.some((flag) =>
    hardCheckDefaults.criticalArtifacts.includes(flag),
  );
  if (hasCriticalArtifact) {
    return "fail";
  }

  // Weighted soft score threshold
  const weightedScore = computeWeightedSoftScore(score.softScores, softScoreDefaults.weights);
  if (weightedScore < softScoreDefaults.reviewThreshold) {
    return "review";
  }

  return "pass";
}

// ── Prompt ──

function buildRealismPrompt(input: RealismScorerInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are a UGC ad quality scorer. Evaluate the generated video across multiple dimensions.

Score each dimension from 0.0 to 1.0:

## Hard Checks
- **faceSimilarity**: How closely does the face match the creator reference? (0 = completely different, 1 = identical). If no reference provided or no face visible, omit this field.
- **ocrAccuracy**: If product text/logos are shown, how legible and accurate are they? (0 = illegible, 1 = perfect). If no text/logos shown, omit this field.
- **artifactFlags**: List any visual artifacts detected. Valid flags: "face_drift", "hand_warp", "product_warp", "text_illegible", "uncanny_valley", "sync_mismatch", "lighting_inconsistency". Empty array if none.

## Soft Scores (always score all 4)
- **visualRealism**: Skin texture, lighting consistency, camera feel (0 = obviously CG, 1 = photorealistic)
- **behavioralRealism**: Natural blink, mouth movement, head motion, gestures (0 = robotic, 1 = human)
- **ugcAuthenticity**: Does this feel like a real person filmed this on their phone? (0 = studio production, 1 = authentic UGC)
- **audioNaturalness**: Natural speech patterns, breath sounds, room tone, pauses (0 = synthetic, 1 = natural). Score 0.5 if no audio.

Return a JSON object:
{
  "faceSimilarity": 0.85,
  "ocrAccuracy": 0.9,
  "artifactFlags": [],
  "visualRealism": 0.8,
  "behavioralRealism": 0.75,
  "ugcAuthenticity": 0.9,
  "audioNaturalness": 0.7
}

Respond ONLY with the JSON object.`;

  let userMessage = `Score this UGC video for realism:

**Video URL:** ${input.videoUrl}
**Creative brief:** ${input.specDescription}`;

  if (input.creatorReferenceUrl) {
    userMessage += `\n**Creator reference image:** ${input.creatorReferenceUrl}`;
  }

  return { systemPrompt, userMessage };
}

// ── Main scorer ──

/**
 * Full hybrid realism scorer (SP6).
 * Calls Claude Vision for both hard checks and soft scores in a single pass.
 * Applies configurable thresholds to produce pass/review/fail decision.
 */
export async function evaluateRealism(input: RealismScorerInput): Promise<RealismScore> {
  const thresholds = input.thresholds ?? DEFAULT_QA_THRESHOLDS;
  const { systemPrompt, userMessage } = buildRealismPrompt(input);

  const result = await callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    userMessage,
    schema: ClaudeRealismOutputSchema,
    maxTokens: 1024,
  });

  const score: RealismScore = {
    hardChecks: {
      faceSimilarity: result.faceSimilarity,
      ocrAccuracy: result.ocrAccuracy,
      artifactFlags: result.artifactFlags,
    },
    softScores: {
      visualRealism: result.visualRealism,
      behavioralRealism: result.behavioralRealism,
      ugcAuthenticity: result.ugcAuthenticity,
      audioNaturalness: result.audioNaturalness,
    },
    overallDecision: "pass", // placeholder, computed below
  };

  score.overallDecision = computeDecision(score, thresholds);

  return score;
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run realism-scorer
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/realism-scorer.ts packages/core/src/creative-pipeline/__tests__/realism-scorer.test.ts
git commit -m "feat(core): add realism scorer v1 — hybrid hard checks + weighted soft scores"
```

---

## Task 2: Swap Production Phase to Use Realism Scorer

**Files:**

- Modify: `packages/core/src/creative-pipeline/ugc/phases/production.ts`
- Modify: `packages/core/src/creative-pipeline/index.ts`

- [ ] **Step 1: Update production.ts import**

In `packages/core/src/creative-pipeline/ugc/phases/production.ts`, replace:

```typescript
import { evaluateMinimalQa } from "../minimal-qa.js";
```

With:

```typescript
import { evaluateRealism } from "../realism-scorer.js";
```

Then update the QA call inside `processSpec`. Find the call to `evaluateMinimalQa` and replace with:

```typescript
const qaScore = await evaluateRealism({
  videoUrl: result.videoUrl,
  specDescription: `${spec.format} ${spec.structureId} ad`,
  apiKey: deps.apiKey,
});
```

The interface is compatible — both return `RealismScore`.

- [ ] **Step 2: Update barrel exports**

In `packages/core/src/creative-pipeline/index.ts`, replace:

```typescript
export { evaluateMinimalQa } from "./ugc/minimal-qa.js";
```

With:

```typescript
export {
  evaluateRealism,
  computeDecision,
  computeWeightedSoftScore,
  DEFAULT_QA_THRESHOLDS,
} from "./ugc/realism-scorer.js";
export type { QaThresholdConfig, RealismScorerInput } from "./ugc/realism-scorer.js";
```

- [ ] **Step 3: Run production phase tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run production-phase
```

The production phase tests mock `call-claude.js`. The mock returns a flat object — the new scorer will try to parse it. Update the mock in `production-phase.test.ts` to return the new shape:

Replace the existing mock:

```typescript
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    decision: "pass",
    reasoning: "Looks good",
    artifactFlags: [],
  }),
}));
```

With:

```typescript
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    faceSimilarity: 0.9,
    ocrAccuracy: 0.95,
    artifactFlags: [],
    visualRealism: 0.8,
    behavioralRealism: 0.8,
    ugcAuthenticity: 0.85,
    audioNaturalness: 0.75,
  }),
}));
```

And update the "retries on QA failure" test mock to return scores that trigger a fail:

```typescript
mockClaude
  .mockResolvedValueOnce({
    faceSimilarity: 0.3, // below 0.7 threshold → fail
    ocrAccuracy: 0.9,
    artifactFlags: ["face_drift"],
    visualRealism: 0.3,
    behavioralRealism: 0.3,
    ugcAuthenticity: 0.3,
    audioNaturalness: 0.3,
  })
  .mockResolvedValueOnce({
    faceSimilarity: 0.9,
    ocrAccuracy: 0.95,
    artifactFlags: [],
    visualRealism: 0.8,
    behavioralRealism: 0.8,
    ugcAuthenticity: 0.85,
    audioNaturalness: 0.75,
  });
```

And similar for the "reports failed spec" and "falls back to asset reuse" and "circuit breaker" tests — any test that expects QA failures should mock scores that trigger the hard check gates.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/phases/production.ts packages/core/src/creative-pipeline/index.ts packages/core/src/creative-pipeline/__tests__/production-phase.test.ts
git commit -m "feat(core): swap production phase from minimal QA to realism scorer v1"
```

---

## Task 3: Full Build + Test Verification

- [ ] **Step 1: Run all UGC tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run realism-scorer && npx pnpm@9.15.4 --filter @switchboard/core test -- --run production-phase
```

- [ ] **Step 2: Run typecheck + lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck 2>&1 | tail -40
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint 2>&1 | tail -40
```

- [ ] **Step 3: Fix any issues, commit if needed**
