// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Creative Handler Functions
// ---------------------------------------------------------------------------
// Extracted from handlers.ts to keep file sizes under 400 lines.
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";

import { collectNormalizedData } from "../data/normalizer.js";
import { analyzeCreativeGaps } from "../creative/gap-analysis.js";
import { generateCreativeStrategy } from "../creative/strategy-generator.js";
import { CreativePipeline } from "../creative/pipeline.js";

import type { RevGrowthDeps } from "../data/normalizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failResult(summary: string, step: string, start: number): ExecuteResult {
  return {
    success: false,
    summary,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step, error: summary }],
    durationMs: Date.now() - start,
    undoRecipe: null,
  };
}

// ---------------------------------------------------------------------------
// handleCreativeAnalyzeGaps — Analyze creative portfolio gaps
// ---------------------------------------------------------------------------

export async function handleCreativeAnalyzeGaps(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  const organizationId = parameters["organizationId"] as string;

  if (!accountId || !organizationId) {
    return failResult(
      "Missing required parameters: accountId and organizationId",
      "validate",
      start,
    );
  }

  const normalizedData = await collectNormalizedData(accountId, organizationId, deps);

  let profile = null;
  if (deps?.accountProfileStore) {
    profile = await deps.accountProfileStore.getByAccountId(accountId);
  }

  const gapResult = analyzeCreativeGaps(normalizedData, profile);

  return {
    success: true,
    summary: `Creative gap analysis: score ${gapResult.overallScore.toFixed(1)}, ${gapResult.significantGaps.length} significant gap(s)`,
    externalRefs: { accountId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: gapResult,
  };
}

// ---------------------------------------------------------------------------
// handleCreativeGenerateStrategy — Generate a creative strategy
// ---------------------------------------------------------------------------

export async function handleCreativeGenerateStrategy(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  const organizationId = parameters["organizationId"] as string;

  if (!accountId || !organizationId) {
    return failResult(
      "Missing required parameters: accountId and organizationId",
      "validate",
      start,
    );
  }

  const normalizedData = await collectNormalizedData(accountId, organizationId, deps);

  let profile = null;
  if (deps?.accountProfileStore) {
    profile = await deps.accountProfileStore.getByAccountId(accountId);
  }

  const gapResult = analyzeCreativeGaps(normalizedData, profile);
  const strategy = await generateCreativeStrategy(gapResult, {
    accountProfile: profile,
    llmClient: deps?.llmClient,
  });

  return {
    success: true,
    summary: `Creative strategy: ${strategy.headline}`,
    externalRefs: { accountId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: strategy,
  };
}

// ---------------------------------------------------------------------------
// handleCreativeDeployTest — Full creative pipeline
// ---------------------------------------------------------------------------

export async function handleCreativeDeployTest(
  parameters: Record<string, unknown>,
  deps: RevGrowthDeps | null,
  start: number,
): Promise<ExecuteResult> {
  const accountId = parameters["accountId"] as string;
  const organizationId = parameters["organizationId"] as string;

  if (!accountId || !organizationId) {
    return failResult(
      "Missing required parameters: accountId and organizationId",
      "validate",
      start,
    );
  }

  const normalizedData = await collectNormalizedData(accountId, organizationId, deps);

  let profile = null;
  if (deps?.accountProfileStore) {
    profile = await deps.accountProfileStore.getByAccountId(accountId);
  }

  const pipeline = new CreativePipeline();
  const result = await pipeline.run(
    accountId,
    organizationId,
    "CREATIVE",
    normalizedData,
    {
      imageGenerator: deps?.imageGenerator,
      testCampaignStore: deps?.testCampaignStore,
      dispatcher: deps?.dispatcher,
      llmClient: deps?.llmClient,
    },
    profile,
  );

  const summary = result.skipped
    ? `Creative pipeline skipped: ${result.skipReason}`
    : `Creative pipeline complete: ${result.significantGaps.length} gap(s), ${result.generatedImages.length} image(s), campaign ${result.campaignDeployed ? "deployed" : "pending"}`;

  return {
    success: true,
    summary,
    externalRefs: { accountId, ...(result.campaignId ? { campaignId: result.campaignId } : {}) },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: result,
  };
}
