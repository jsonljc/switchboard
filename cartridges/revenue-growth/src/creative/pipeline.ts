// ---------------------------------------------------------------------------
// Creative Pipeline Orchestrator — End-to-end creative workflow
// ---------------------------------------------------------------------------
// Chains: analyzeGaps → generateStrategy → generateImages →
//         reviewAds → deployCampaign
// Short-circuits if no significant gaps are found.
// ---------------------------------------------------------------------------

import type { NormalizedData, ConstraintType, AccountLearningProfile } from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";
import type { TestCampaignStore } from "../stores/interfaces.js";
import type { ImageGenerator, GeneratedImage } from "./image-generator.js";
import type { InterventionDispatcher } from "../execution/dispatcher.js";
import type { CreativeStrategy } from "./strategy-generator.js";
import type { AdReviewResult } from "./ad-review-checker.js";

import { analyzeCreativeGaps } from "./gap-analysis.js";
import { generateCreativeStrategy } from "./strategy-generator.js";
import { AdReviewChecker } from "./ad-review-checker.js";
import { CampaignDeployer } from "../execution/campaign-deploy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreativePipelineDeps {
  imageGenerator?: ImageGenerator;
  testCampaignStore?: TestCampaignStore;
  dispatcher?: InterventionDispatcher;
  llmClient?: LLMClient;
}

export interface CreativePipelineResult {
  skipped: boolean;
  skipReason?: string;
  gapScore: number;
  significantGaps: string[];
  strategy?: CreativeStrategy;
  generatedImages: GeneratedImage[];
  reviewResults: AdReviewResult[];
  campaignId?: string;
  campaignDeployed: boolean;
}

// ---------------------------------------------------------------------------
// CreativePipeline
// ---------------------------------------------------------------------------

export class CreativePipeline {
  /**
   * Run the full creative pipeline for an account.
   */
  async run(
    accountId: string,
    organizationId: string,
    constraintType: ConstraintType,
    normalizedData: NormalizedData,
    deps: CreativePipelineDeps,
    accountProfile?: AccountLearningProfile | null,
  ): Promise<CreativePipelineResult> {
    // Step 1: Analyze creative gaps
    const gapResult = analyzeCreativeGaps(normalizedData, accountProfile);

    // Short-circuit if no significant gaps
    if (!gapResult.hasSignificantGaps) {
      return {
        skipped: true,
        skipReason: "No significant creative gaps detected",
        gapScore: gapResult.overallScore,
        significantGaps: [],
        generatedImages: [],
        reviewResults: [],
        campaignDeployed: false,
      };
    }

    // Step 2: Generate creative strategy
    const strategy = await generateCreativeStrategy(gapResult, {
      accountProfile,
      llmClient: deps.llmClient,
    });

    // Step 3: Generate images (if image generator available)
    const generatedImages: GeneratedImage[] = [];
    if (deps.imageGenerator && strategy.recommendations.length > 0) {
      for (const rec of strategy.recommendations.slice(0, 3)) {
        try {
          const image = await deps.imageGenerator.generate(
            `Creative ad for ${rec.gap}: ${rec.action}`,
          );
          generatedImages.push(image);
        } catch {
          // Non-critical — continue without this image
        }
      }
    }

    // Step 4: Review generated assets
    const checker = new AdReviewChecker();
    const assetsForReview = generatedImages.map((img) => ({
      id: img.id,
      type: "image" as const,
      textContent: img.prompt,
      imageUrl: img.url,
    }));
    const reviewResults = checker.checkBatch(assetsForReview);

    // Filter to only passed assets
    const passedAssetIds = reviewResults.filter((r) => r.passed).map((r) => r.assetId);

    // Step 5: Deploy test campaign (if store and passed assets available)
    let campaignId: string | undefined;
    let campaignDeployed = false;

    if (deps.testCampaignStore && passedAssetIds.length > 0) {
      const deployer = new CampaignDeployer(deps.testCampaignStore, deps.dispatcher);
      const campaign = await deployer.createTestCampaign({
        accountId,
        organizationId,
        constraintType,
        creativeAssetIds: passedAssetIds,
        budget: 100, // Default test budget
      });

      campaignId = campaign.id;

      try {
        const deployResult = await deployer.deploy(campaign.id, "APPROVAL_REQUIRED");
        campaignDeployed = deployResult.dispatched;
      } catch {
        // Campaign creation succeeded but deployment failed — still useful
      }
    }

    return {
      skipped: false,
      gapScore: gapResult.overallScore,
      significantGaps: gapResult.significantGaps,
      strategy,
      generatedImages,
      reviewResults,
      campaignId,
      campaignDeployed,
    };
  }
}
