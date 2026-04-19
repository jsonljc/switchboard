# UGC v2 SP7 — Provider Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the provider system from hardcoded Kling to a multi-provider architecture with Seedance + Runway adapters, provider performance history tracking, and history-informed ranking.

**Architecture:** Three components: (1) Provider adapter interface — abstracts generation behind a common `VideoProvider` interface so the production phase doesn't care which provider it's using; (2) Provider performance history — tracks pass rate, avg latency, and avg cost per provider per deployment; (3) Enhanced provider router — uses history data alongside capability scoring for ranking.

**Tech Stack:** TypeScript ESM, Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 4.4, 5.3

---

## File Map

### New files

| File                                                                         | Responsibility                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/video-provider.ts`                  | `VideoProvider` interface + adapter implementations for Kling, Seedance, Runway |
| `packages/core/src/creative-pipeline/ugc/provider-performance.ts`            | `ProviderPerformanceHistory` type + in-memory tracker                           |
| `packages/core/src/creative-pipeline/__tests__/video-provider.test.ts`       | Tests for provider adapters                                                     |
| `packages/core/src/creative-pipeline/__tests__/provider-performance.test.ts` | Tests for performance tracking                                                  |

### Modified files

| File                                                                    | Change                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/provider-router.ts`            | Add Seedance + Runway profiles, integrate performance history into ranking                |
| `packages/core/src/creative-pipeline/__tests__/provider-router.test.ts` | Tests for new providers + history-weighted ranking                                        |
| `packages/core/src/creative-pipeline/ugc/phases/production.ts`          | Use `VideoProvider` interface instead of `KlingLike`, select provider adapter dynamically |
| `packages/core/src/creative-pipeline/index.ts`                          | Export SP7 modules                                                                        |

---

## Task 1: Video Provider Interface + Adapters

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/video-provider.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/video-provider.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/video-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createVideoProvider, type VideoGenerationRequest } from "../ugc/video-provider.js";

describe("createVideoProvider", () => {
  it("creates a kling provider adapter", () => {
    const mockKling = {
      generateVideo: vi
        .fn()
        .mockResolvedValue({ videoUrl: "https://cdn.example.com/kling.mp4", duration: 10 }),
    };
    const provider = createVideoProvider("kling", { klingClient: mockKling as never });
    expect(provider).toBeDefined();
    expect(provider.name).toBe("kling");
  });

  it("kling adapter calls klingClient.generateVideo", async () => {
    const mockKling = {
      generateVideo: vi
        .fn()
        .mockResolvedValue({ videoUrl: "https://cdn.example.com/kling.mp4", duration: 10 }),
    };
    const provider = createVideoProvider("kling", { klingClient: mockKling as never });

    const req: VideoGenerationRequest = {
      prompt: "Test prompt",
      durationSec: 15,
      aspectRatio: "9:16",
      referenceImageUrl: undefined,
    };
    const result = await provider.generate(req);

    expect(mockKling.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Test prompt", aspectRatio: "9:16" }),
    );
    expect(result.videoUrl).toBe("https://cdn.example.com/kling.mp4");
  });

  it("creates a seedance provider adapter (stub)", () => {
    const provider = createVideoProvider("seedance", {});
    expect(provider).toBeDefined();
    expect(provider.name).toBe("seedance");
  });

  it("seedance adapter throws not-implemented", async () => {
    const provider = createVideoProvider("seedance", {});
    await expect(
      provider.generate({
        prompt: "test",
        durationSec: 10,
        aspectRatio: "9:16",
      }),
    ).rejects.toThrow("not yet implemented");
  });

  it("creates a runway provider adapter (stub)", () => {
    const provider = createVideoProvider("runway", {});
    expect(provider).toBeDefined();
    expect(provider.name).toBe("runway");
  });

  it("runway adapter throws not-implemented", async () => {
    const provider = createVideoProvider("runway", {});
    await expect(
      provider.generate({
        prompt: "test",
        durationSec: 10,
        aspectRatio: "9:16",
      }),
    ).rejects.toThrow("not yet implemented");
  });

  it("throws for unknown provider", () => {
    expect(() => createVideoProvider("unknown", {})).toThrow("Unknown provider: unknown");
  });
});
```

- [ ] **Step 2: Implement video-provider.ts**

Create `packages/core/src/creative-pipeline/ugc/video-provider.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/video-provider.ts

// ── Types ──

export interface VideoGenerationRequest {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  referenceImageUrl?: string;
  negativePrompt?: string;
  cameraMotion?: string;
}

export interface VideoGenerationResult {
  videoUrl: string;
  duration: number;
  provider: string;
}

export interface VideoProvider {
  name: string;
  generate(request: VideoGenerationRequest): Promise<VideoGenerationResult>;
}

// ── Kling adapter ──

interface KlingLike {
  generateVideo(req: {
    prompt: string;
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
    imageUrl?: string;
    negativePrompt?: string;
    cameraMotion?: string;
  }): Promise<{ videoUrl: string; duration: number }>;
}

function mapDuration(sec: number): 5 | 10 {
  return sec <= 7 ? 5 : 10;
}

function mapAspect(aspect: string): "16:9" | "9:16" | "1:1" {
  if (aspect === "16:9") return "16:9";
  if (aspect === "1:1") return "1:1";
  return "9:16";
}

function createKlingAdapter(klingClient: KlingLike): VideoProvider {
  return {
    name: "kling",
    async generate(req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      const result = await klingClient.generateVideo({
        prompt: req.prompt,
        duration: mapDuration(req.durationSec),
        aspectRatio: mapAspect(req.aspectRatio),
        imageUrl: req.referenceImageUrl,
        negativePrompt: req.negativePrompt,
        cameraMotion: req.cameraMotion,
      });
      return { videoUrl: result.videoUrl, duration: result.duration, provider: "kling" };
    },
  };
}

// ── Seedance adapter (stub — activates when API is available) ──

function createSeedanceAdapter(): VideoProvider {
  return {
    name: "seedance",
    async generate(_req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      throw new Error("Seedance provider not yet implemented — awaiting API access");
    },
  };
}

// ── Runway adapter (stub — activates when API is available) ──

function createRunwayAdapter(): VideoProvider {
  return {
    name: "runway",
    async generate(_req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      throw new Error("Runway provider not yet implemented — awaiting API access");
    },
  };
}

// ── Factory ──

interface ProviderClients {
  klingClient?: KlingLike;
}

export function createVideoProvider(provider: string, clients: ProviderClients): VideoProvider {
  switch (provider) {
    case "kling": {
      if (!clients.klingClient) {
        throw new Error("Kling client not configured");
      }
      return createKlingAdapter(clients.klingClient);
    }
    case "seedance":
      return createSeedanceAdapter();
    case "runway":
      return createRunwayAdapter();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run video-provider
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/video-provider.ts packages/core/src/creative-pipeline/__tests__/video-provider.test.ts
git commit -m "feat(core): add VideoProvider interface with Kling adapter + Seedance/Runway stubs"
```

---

## Task 2: Provider Performance History

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/provider-performance.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/provider-performance.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/provider-performance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ProviderPerformanceTracker } from "../ugc/provider-performance.js";

describe("ProviderPerformanceTracker", () => {
  it("starts with empty history", () => {
    const tracker = new ProviderPerformanceTracker();
    const history = tracker.getHistory();
    expect(history.passRateByProvider).toEqual({});
    expect(history.avgLatencyByProvider).toEqual({});
    expect(history.costByProvider).toEqual({});
  });

  it("records a successful attempt", () => {
    const tracker = new ProviderPerformanceTracker();
    tracker.record({ provider: "kling", passed: true, latencyMs: 5000, cost: 0.5 });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBe(1.0);
    expect(history.avgLatencyByProvider["kling"]).toBe(5000);
    expect(history.costByProvider["kling"]).toBe(0.5);
  });

  it("records mixed results and computes averages", () => {
    const tracker = new ProviderPerformanceTracker();
    tracker.record({ provider: "kling", passed: true, latencyMs: 4000, cost: 0.5 });
    tracker.record({ provider: "kling", passed: false, latencyMs: 6000, cost: 0.5 });
    tracker.record({ provider: "kling", passed: true, latencyMs: 5000, cost: 0.5 });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBeCloseTo(0.667, 2);
    expect(history.avgLatencyByProvider["kling"]).toBe(5000);
    expect(history.costByProvider["kling"]).toBe(0.5);
  });

  it("tracks multiple providers independently", () => {
    const tracker = new ProviderPerformanceTracker();
    tracker.record({ provider: "kling", passed: true, latencyMs: 4000, cost: 0.5 });
    tracker.record({ provider: "heygen", passed: false, latencyMs: 8000, cost: 1.0 });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBe(1.0);
    expect(history.passRateByProvider["heygen"]).toBe(0.0);
    expect(history.avgLatencyByProvider["kling"]).toBe(4000);
    expect(history.avgLatencyByProvider["heygen"]).toBe(8000);
  });

  it("can be initialized from existing history", () => {
    const tracker = ProviderPerformanceTracker.fromHistory({
      passRateByProvider: { kling: 0.8 },
      avgLatencyByProvider: { kling: 5000 },
      costByProvider: { kling: 0.5 },
    });
    const history = tracker.getHistory();
    expect(history.passRateByProvider["kling"]).toBe(0.8);
  });
});
```

- [ ] **Step 2: Implement provider-performance.ts**

Create `packages/core/src/creative-pipeline/ugc/provider-performance.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/provider-performance.ts

// ── Types ──

export interface ProviderPerformanceHistory {
  passRateByProvider: Record<string, number>;
  avgLatencyByProvider: Record<string, number>;
  costByProvider: Record<string, number>;
}

export interface PerformanceRecord {
  provider: string;
  passed: boolean;
  latencyMs: number;
  cost: number;
}

// ── Tracker ──

interface ProviderStats {
  totalAttempts: number;
  passedAttempts: number;
  totalLatencyMs: number;
  totalCost: number;
}

export class ProviderPerformanceTracker {
  private stats: Record<string, ProviderStats> = {};

  record(record: PerformanceRecord): void {
    if (!this.stats[record.provider]) {
      this.stats[record.provider] = {
        totalAttempts: 0,
        passedAttempts: 0,
        totalLatencyMs: 0,
        totalCost: 0,
      };
    }
    const s = this.stats[record.provider];
    s.totalAttempts++;
    if (record.passed) s.passedAttempts++;
    s.totalLatencyMs += record.latencyMs;
    s.totalCost += record.cost;
  }

  getHistory(): ProviderPerformanceHistory {
    const passRateByProvider: Record<string, number> = {};
    const avgLatencyByProvider: Record<string, number> = {};
    const costByProvider: Record<string, number> = {};

    for (const [provider, s] of Object.entries(this.stats)) {
      passRateByProvider[provider] = s.totalAttempts > 0 ? s.passedAttempts / s.totalAttempts : 0;
      avgLatencyByProvider[provider] = s.totalAttempts > 0 ? s.totalLatencyMs / s.totalAttempts : 0;
      costByProvider[provider] = s.totalAttempts > 0 ? s.totalCost / s.totalAttempts : 0;
    }

    return { passRateByProvider, avgLatencyByProvider, costByProvider };
  }

  static fromHistory(history: ProviderPerformanceHistory): ProviderPerformanceTracker {
    const tracker = new ProviderPerformanceTracker();
    // Initialize with synthetic stats that reproduce the given rates
    for (const provider of Object.keys(history.passRateByProvider)) {
      const passRate = history.passRateByProvider[provider] ?? 0;
      const avgLatency = history.avgLatencyByProvider[provider] ?? 0;
      const avgCost = history.costByProvider[provider] ?? 0;
      // Use 10 as synthetic sample size to represent the historical data
      const sampleSize = 10;
      tracker.stats[provider] = {
        totalAttempts: sampleSize,
        passedAttempts: Math.round(passRate * sampleSize),
        totalLatencyMs: avgLatency * sampleSize,
        totalCost: avgCost * sampleSize,
      };
    }
    return tracker;
  }
}

export function emptyPerformanceHistory(): ProviderPerformanceHistory {
  return { passRateByProvider: {}, avgLatencyByProvider: {}, costByProvider: {} };
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run provider-performance
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/provider-performance.ts packages/core/src/creative-pipeline/__tests__/provider-performance.test.ts
git commit -m "feat(core): add provider performance tracker — pass rate, latency, cost per provider"
```

---

## Task 3: Enhanced Provider Router

Add Seedance + Runway to the registry and integrate performance history into ranking.

**Files:**

- Modify: `packages/core/src/creative-pipeline/ugc/provider-router.ts`
- Modify: `packages/core/src/creative-pipeline/__tests__/provider-router.test.ts`

- [ ] **Step 1: Update provider-router.ts**

Add Seedance and Runway profiles to `getDefaultProviderRegistry()`:

```typescript
    {
      provider: "seedance",
      role: "planned",
      identityStrength: "medium",
      supportsIdentityObject: false,
      supportsReferenceImages: true,
      supportsFirstLastFrame: true,
      supportsExtension: true,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: false,
      supportsProductTextIntegrity: false,
      apiMaturity: "low",
      seedSupport: false,
      versionPinning: false,
    },
    {
      provider: "runway",
      role: "planned",
      identityStrength: "medium",
      supportsIdentityObject: false,
      supportsReferenceImages: true,
      supportsFirstLastFrame: true,
      supportsExtension: false,
      supportsMotionTransfer: false,
      supportsMultiShot: false,
      supportsAudioDrivenTalkingHead: false,
      supportsProductTextIntegrity: false,
      apiMaturity: "low",
      seedSupport: true,
      versionPinning: true,
    },
```

Add cost entries:

```typescript
const ESTIMATED_COST: Record<string, number> = {
  kling: 0.5,
  heygen: 1.0,
  seedance: 0.6,
  runway: 0.8,
};
```

Update `rankProviders` to accept optional `ProviderPerformanceHistory` and integrate it:

```typescript
import type { ProviderPerformanceHistory } from "./provider-performance.js";

export function rankProviders(
  spec: SpecForRouting,
  registry: ProviderCapabilityProfile[],
  history?: ProviderPerformanceHistory,
): RankedProvider[] {
  return registry
    .filter((p) => (p.role === "production" || p.role === "narrow_use") && p.apiMaturity !== "low")
    .map((profile) => {
      let score = scoreProvider(profile, spec);

      // Historical performance bonus (if available)
      if (history) {
        const passRate = history.passRateByProvider[profile.provider];
        if (passRate !== undefined) {
          score += passRate * 0.3; // up to +0.3 for 100% pass rate
        }
        const avgLatency = history.avgLatencyByProvider[profile.provider];
        if (avgLatency !== undefined && avgLatency > 0) {
          // Faster = better: bonus inversely proportional to latency (capped)
          score += Math.min(0.2, (5000 / avgLatency) * 0.1);
        }
      }

      return {
        profile,
        score,
        estimatedCost: ESTIMATED_COST[profile.provider] ?? 1.0,
      };
    })
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 2: Update tests**

Add to `packages/core/src/creative-pipeline/__tests__/provider-router.test.ts`:

```typescript
it("includes Seedance and Runway in default registry", () => {
  const registry = getDefaultProviderRegistry();
  expect(registry.find((p) => p.provider === "seedance")).toBeDefined();
  expect(registry.find((p) => p.provider === "runway")).toBeDefined();
});

it("excludes planned providers from ranking (apiMaturity=low)", () => {
  const ranked = rankProviders(
    { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
    getDefaultProviderRegistry(),
  );
  expect(ranked.find((r) => r.profile.provider === "seedance")).toBeUndefined();
  expect(ranked.find((r) => r.profile.provider === "runway")).toBeUndefined();
});

it("boosts providers with high pass rate from history", () => {
  const registry = getDefaultProviderRegistry().filter((p) => p.role !== "planned");
  const withHistory = rankProviders(
    { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
    registry,
    {
      passRateByProvider: { heygen: 0.95, kling: 0.5 },
      avgLatencyByProvider: {},
      costByProvider: {},
    },
  );
  const withoutHistory = rankProviders(
    { format: "talking_head", identityConstraints: { strategy: "reference_conditioning" } },
    registry,
  );
  // HeyGen should rank higher with strong history
  const heygenWithHistory = withHistory.find((r) => r.profile.provider === "heygen")!;
  const heygenWithout = withoutHistory.find((r) => r.profile.provider === "heygen")!;
  expect(heygenWithHistory.score).toBeGreaterThan(heygenWithout.score);
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run provider-router
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/provider-router.ts packages/core/src/creative-pipeline/__tests__/provider-router.test.ts
git commit -m "feat(core): expand provider registry — Seedance + Runway profiles, history-weighted ranking"
```

---

## Task 4: Update Production Phase + Exports

**Files:**

- Modify: `packages/core/src/creative-pipeline/ugc/phases/production.ts`
- Modify: `packages/core/src/creative-pipeline/index.ts`

- [ ] **Step 1: Update production.ts to use VideoProvider**

In `production.ts`:

1. Replace the `KlingLike` interface with a `VideoProvider` import:

```typescript
import { createVideoProvider, type VideoProvider } from "../video-provider.js";
```

2. Update `ProductionDeps` to accept provider clients instead of just klingClient:

```typescript
interface ProductionDeps {
  providerClients: { klingClient?: unknown };
  assetStore: AssetStoreLike;
  apiKey: string;
}
```

3. In `processSpec`, create a VideoProvider for the ranked provider and call `provider.generate()`:

```typescript
      try {
        const videoProvider = createVideoProvider(provider.profile.provider, deps.providerClients as never);
        const result = await videoProvider.generate({
          prompt: spec.script.text,
          durationSec: spec.renderTargets.durationSec,
          aspectRatio: spec.renderTargets.aspect,
        });
```

4. Remove the old `mapAspect` and `mapDuration` functions (they're now in video-provider.ts).

- [ ] **Step 2: Update production tests**

In `production-phase.test.ts`, update `createMockDeps` to use the new shape:

```typescript
function createMockDeps() {
  return {
    providerClients: {
      klingClient: {
        generateVideo: vi.fn().mockResolvedValue({
          videoUrl: "https://cdn.example.com/generated.mp4",
          duration: 15,
        }),
      },
    },
    assetStore: { ... },
    apiKey: "test-key",
  };
}
```

And update any assertion that checks `deps.klingClient.generateVideo` to `deps.providerClients.klingClient.generateVideo`.

- [ ] **Step 3: Update barrel exports**

Add to `packages/core/src/creative-pipeline/index.ts`:

```typescript
export { createVideoProvider } from "./ugc/video-provider.js";
export type {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
} from "./ugc/video-provider.js";
export { ProviderPerformanceTracker, emptyPerformanceHistory } from "./ugc/provider-performance.js";
export type { ProviderPerformanceHistory, PerformanceRecord } from "./ugc/provider-performance.js";
```

- [ ] **Step 4: Update ugc-job-runner.ts deps**

In `ugc-job-runner.ts`, update the production case to pass `providerClients` instead of `klingClient`:

```typescript
        deps: {
          providerClients: { klingClient: ctx.context.klingClient },
          assetStore: ctx.context.assetStore as any,
          apiKey: ctx.context.apiKey,
        },
```

- [ ] **Step 5: Update inngest.ts**

In `apps/api/src/bootstrap/inngest.ts`, the `createUgcJobRunner` call should still pass `klingClient` — the runner wraps it into `providerClients` internally. No change needed unless the deps interface changed at the runner level. Check and adjust if needed.

- [ ] **Step 6: Run all tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run production-phase && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-job-runner
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/phases/production.ts packages/core/src/creative-pipeline/__tests__/production-phase.test.ts packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts packages/core/src/creative-pipeline/index.ts
git commit -m "feat(core): integrate VideoProvider into production phase, export SP7 modules"
```

---

## Task 5: Full Build + Test Verification

- [ ] **Step 1: Run full core test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test 2>&1 | tail -40
```

- [ ] **Step 2: Run typecheck + lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck 2>&1 | tail -40
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint 2>&1 | tail -40
```

- [ ] **Step 3: Fix any SP7-related issues, commit if needed**
