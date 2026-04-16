// packages/core/src/creative-pipeline/ugc/phases/production.ts
import type { ProviderCapabilityProfile, RealismScore } from "@switchboard/schemas";
import {
  rankProviders,
  getDefaultProviderRegistry,
  type RankedProvider,
} from "../provider-router.js";
import { evaluateRealism } from "../realism-scorer.js";

// ── Types ──

interface CreativeSpecInput {
  specId: string;
  jobId?: string;
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

        // Realism scorer
        const qaScore = await evaluateRealism({
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
          jobId: spec.jobId ?? "unknown",
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
  let totalCost = 0;

  for (const spec of specs) {
    // Budget guard
    if (totalCost > input.budget.totalJobBudget) {
      failedSpecs.push({ specId: spec.specId, reason: "budget exceeded" });
      continue;
    }

    const ranked = rankProviders(
      { format: spec.format, identityConstraints: spec.identityConstraints },
      registry,
    ).slice(0, retryConfig.maxProviderFallbacks + 1);

    const result = await processSpec(spec, ranked, retryConfig, deps);

    qaResults[spec.specId] = result.qaHistory;

    if (result.asset) {
      assets.push(result.asset);
      totalCost += result.asset.costEstimate;
    }
    if (result.failed) {
      failedSpecs.push(result.failed);
    }
  }

  return { assets, qaResults, failedSpecs };
}
