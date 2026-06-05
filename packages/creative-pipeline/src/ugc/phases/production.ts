// packages/creative-pipeline/src/ugc/phases/production.ts
import type { ProviderCapabilityProfile, RealismScore } from "@switchboard/schemas";
import {
  rankProviders,
  getDefaultProviderRegistry,
  type RankedProvider,
} from "../provider-router.js";
import { deriveApprovalState, evaluateRealism, type RealismScorerDeps } from "../realism-scorer.js";
import { buildFrameQaDeps } from "../frame-qa-deps.js";
import { buildUgcVideoRequest } from "../video-prompt.js";
import { downloadVideoToTmp } from "../video-download.js";
import { createVideoProvider, type ProviderClients } from "../video-provider.js";
import type { ProviderPerformanceHistory } from "../provider-performance.js";
import type { AssetStorageClient } from "../../stages/video-producer.js";

// ── Types ──

interface CreativeSpecInput {
  specId: string;
  jobId?: string;
  deploymentId?: string;
  creatorId: string;
  structureId: string;
  platform: string;
  script: { text: string; language: string };
  /** SceneStyle from scripting (slice-3 spec 3.2); parsed in the prompt builder. */
  style?: unknown;
  /** UgcDirection from scripting; parsed in the prompt builder. */
  direction?: unknown;
  /** Product grounding image (product_in_hand format only; set at scripting). */
  referenceImageUrl?: string;
  /** Avatar refs from the cast creator (slice-3 spec 3.5; heygen routing). */
  creator?: { heygenAvatarId?: string; heygenVoiceId?: string };
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
  /**
   * Set when the asset's bytes were durably uploaded (slice-3 spec 3.3f);
   * the runner promotes the first non-rejected asset's value to
   * CreativeJob.durableAssetUrl so a kept UGC creative is publishable.
   */
  durableAssetUrl?: string;
}

interface AssetStoreLike {
  upsertByKey(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  findLockedByCreator(creatorId: string): Promise<Record<string, unknown> | null>;
}

interface ProductionDeps {
  providerClients: ProviderClients;
  assetStore: AssetStoreLike;
  apiKey: string;
  /**
   * Durable storage for final assets (slice-3 spec 3.3f). The exact polished
   * layering: interface owned here, S3 impl injected from bootstrap. Absent =
   * provider URLs persist as-is and publish stays loud-blocked downstream.
   */
  assetStorage?: AssetStorageClient;
}

export interface ProductionInput {
  specs: CreativeSpecInput[];
  providerRegistry: ProviderCapabilityProfile[];
  providerHistory?: ProviderPerformanceHistory;
  retryConfig: { maxAttempts: number; maxProviderFallbacks: number };
  budget: { totalJobBudget: number; costAuthority: string };
  deps: ProductionDeps;
}

export interface ProductionOutput {
  assets: AssetRecordOutput[];
  qaResults: Record<string, Array<{ attempt: number; provider: string; score: RealismScore }>>;
  failedSpecs: Array<{ specId: string; reason: string }>;
}

// ── Hash helper ──

function hashInputs(spec: CreativeSpecInput): Record<string, string> {
  // Simple hash — upgrade to content-addressable hashing when asset deduplication is needed
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
  costTracker: { total: number },
  qaDeps: RealismScorerDeps | undefined,
): Promise<{
  asset?: AssetRecordOutput;
  qaHistory: Array<{ attempt: number; provider: string; score: RealismScore }>;
  failed?: { specId: string; reason: string };
}> {
  const qaHistory: Array<{ attempt: number; provider: string; score: RealismScore }> = [];
  let totalAttempts = 0;
  let lastFailedAsset: AssetRecordOutput | undefined;

  for (const provider of rankedProviders) {
    // Per-provider attempt cap (slice-3 spec 3.5): heygen gets one shot
    // before fallback; others use the spec's retry config.
    const attemptsFor = Math.min(
      provider.attemptLimit ?? retryConfig.maxAttempts,
      retryConfig.maxAttempts,
    );
    for (let attempt = 0; attempt < attemptsFor; attempt++) {
      totalAttempts++;
      const startMs = Date.now();

      try {
        // Generate video with the direction-faithful request (slice-3 spec
        // 3.2): SceneStyle/UgcDirection compose into prompt + negative +
        // camera motion; absent/unparseable falls back to raw script text.
        const videoProvider = createVideoProvider(provider.profile.provider, deps.providerClients);
        const result = await videoProvider.generate(buildUgcVideoRequest(spec));

        // Attempt-accurate budget (slice-3 spec 3.1): a successful generation
        // is paid render spend whether or not its QA verdict survives, so it
        // accrues here, not on the returned asset. Generation ERRORS do not
        // bill (no clip was produced) and do not accrue.
        costTracker.total += provider.estimatedCost;

        // Frame QA (real when qaDeps wired; honest stub otherwise)
        const qaScore = await evaluateRealism(
          {
            videoUrl: result.videoUrl,
            specDescription: `${spec.format} ${spec.structureId} ad`,
            apiKey: deps.apiKey,
            format: spec.format,
            durationSec: spec.renderTargets.durationSec,
          },
          qaDeps,
        );

        qaHistory.push({
          attempt: totalAttempts,
          provider: provider.profile.provider,
          score: qaScore,
        });

        const latencyMs = Date.now() - startMs;

        // Persist EVERY generated attempt (write-once-then-enrich, per-attempt:
        // the AssetRecord unique axis is (specId, attemptNumber, provider)).
        const assetData: AssetRecordOutput = {
          specId: spec.specId,
          creatorId: spec.creatorId,
          provider: provider.profile.provider,
          modelId: `${provider.profile.provider}-v1`,
          attemptNumber: totalAttempts,
          inputHashes: hashInputs(spec),
          outputs: { videoUrl: result.videoUrl, checksums: {} },
          qaMetrics: qaScore as unknown as Record<string, unknown>,
          // Snapshot copy: each row records the history SO FAR; persisting the
          // live array by reference would alias every row to the final state.
          qaHistory: [...qaHistory] as unknown as Array<Record<string, unknown>>,
          // Safety: an un-evaluated/fabricated QA score can never auto-approve;
          // `deriveApprovalState` gates on qaStatus === "evaluated".
          approvalState: deriveApprovalState(qaScore),
          latencyMs,
          costEstimate: provider.estimatedCost,
        };

        await deps.assetStore.upsertByKey({
          jobId: spec.jobId ?? "unknown",
          ...assetData,
        });

        // A real evaluated FAIL (critical artifact / hard-check breach) does
        // not return: it re-enters the retry/fallback loop. `review` and
        // `pass` persist and return exactly as before.
        if (qaScore.qaStatus === "evaluated" && qaScore.overallDecision === "fail") {
          lastFailedAsset = assetData;
          continue;
        }

        return { asset: assetData, qaHistory };
      } catch {
        // Generation error — try next attempt/provider
        if (attempt === retryConfig.maxAttempts - 1) break;
      }
    }
  }

  // All attempts exhausted with only failing QA verdicts: the LAST rejected
  // asset is the spec's final output (persisted above; nothing silently
  // dropped) and the spec is reported failed. Garbage renders never fall
  // back to unrelated reuse assets; qa_failed wins here even when LATER
  // attempts threw generation errors (lastFailedAsset may have been set
  // attempts ago, on a different provider).
  if (lastFailedAsset) {
    return {
      asset: lastFailedAsset,
      qaHistory,
      failed: { specId: spec.specId, reason: "qa_failed" },
    };
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

  // Live frame-QA wiring (slice-3 spec 3.1): self-constructed once per phase
  // from the api key the phase already holds; undefined (unconfigured) keeps
  // the honest stub. The factory lives in its own module so tests pin that
  // the evaluator actually receives deps in this path.
  const qaDeps = buildFrameQaDeps(deps.apiKey);

  // Process specs sequentially — add p-limit parallelism when concurrent provider calls are needed.
  // The tracker accrues per ATTEMPT inside processSpec (qa-fail retries spend
  // real money), so the budget guard caps worst-case retry spend.
  const costTracker = { total: 0 };

  for (const spec of specs) {
    // Budget guard
    if (costTracker.total > input.budget.totalJobBudget) {
      failedSpecs.push({ specId: spec.specId, reason: "budget exceeded" });
      continue;
    }

    // providersAllowed is honored (slice-3 spec 3.2): rank, FILTER to the
    // spec's allowlist, then slice fallbacks. Without the filter, heygen's
    // talking-head bonus ranks its throwing stub adapter first and burns
    // maxAttempts before kling ever runs.
    const ranked = rankProviders(
      { format: spec.format, identityConstraints: spec.identityConstraints },
      registry,
      input.providerHistory,
    )
      .filter((r) => spec.providersAllowed.includes(r.profile.provider))
      .slice(0, retryConfig.maxProviderFallbacks + 1);

    if (ranked.length === 0) {
      failedSpecs.push({ specId: spec.specId, reason: "no_allowed_provider" });
      continue;
    }

    const result = await processSpec(spec, ranked, retryConfig, deps, costTracker, qaDeps);

    qaResults[spec.specId] = result.qaHistory;

    if (result.asset) {
      // Durable upload, FINAL non-rejected asset only (slice-3 spec 3.3f):
      // one storage key per spec, so only the asset that survives QA may own
      // it. DELIBERATELY OUTSIDE processSpec's generation try/catch: a
      // storage failure must PROPAGATE (the UGC dead-letter contract:
      // failUgc + ugc.failed), never be swallowed as a generation error that
      // re-bills a QA-passed render or silently drops it.
      if (deps.assetStorage && result.asset.approvalState !== "rejected") {
        await uploadFinalAsset(spec, result.asset, deps);
      }
      assets.push(result.asset);
    }
    if (result.failed) {
      failedSpecs.push(result.failed);
    }
  }

  return { assets, qaResults, failedSpecs };
}

/** Download the provider bytes (SSRF-gated) and replace them with a durable URL. */
async function uploadFinalAsset(
  spec: CreativeSpecInput,
  asset: AssetRecordOutput,
  deps: ProductionDeps,
): Promise<void> {
  const providerUrl = (asset.outputs as { videoUrl?: string }).videoUrl;
  if (typeof providerUrl !== "string" || providerUrl.length === 0) return;

  const download = await downloadVideoToTmp(providerUrl);
  try {
    const key = `creative-assets/${spec.jobId ?? "unknown"}/ugc-${spec.specId}.mp4`;
    const uploaded = await deps.assetStorage!.upload({
      localPath: download.localPath,
      key,
      contentType: "video/mp4",
    });
    asset.durableAssetUrl = uploaded.url;
    asset.outputs = { ...asset.outputs, videoUrl: uploaded.url, sourceUrl: providerUrl };
    // Re-persist the final row with the durable outputs (idempotent: same
    // (specId, attemptNumber, provider) key).
    await deps.assetStore.upsertByKey({ jobId: spec.jobId ?? "unknown", ...asset });
  } finally {
    download.cleanup();
  }
}
