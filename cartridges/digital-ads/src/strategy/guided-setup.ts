// ---------------------------------------------------------------------------
// Guided Setup — Multi-step campaign creation wizard
// ---------------------------------------------------------------------------

import type { GuidedSetupStep, GuidedSetupResult, CampaignObjective } from "./types.js";
import type { MetaAdsWriteProvider } from "../cartridge/types.js";

export interface GuidedSetupParams {
  objective: CampaignObjective;
  campaignName: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  creative: Record<string, unknown>;
  optimizationGoal?: string;
  adSetName?: string;
  adName?: string;
  status?: "ACTIVE" | "PAUSED";
}

export class GuidedSetup {
  constructor(private readonly provider: MetaAdsWriteProvider) {}

  async execute(params: GuidedSetupParams): Promise<GuidedSetupResult> {
    const steps: GuidedSetupStep[] = [];
    const status = params.status ?? "PAUSED";

    // Step 1: Create Campaign
    steps.push({
      step: 1,
      name: "Create Campaign",
      status: "pending",
      data: {},
    });

    let campaignId: string;
    try {
      const campaign = await this.provider.createCampaign({
        name: params.campaignName,
        objective: params.objective,
        dailyBudget: params.dailyBudget,
        status,
      });
      campaignId = campaign.id;
      steps[0]!.status = "completed";
      steps[0]!.data = { campaignId };
    } catch (err) {
      steps[0]!.status = "completed";
      steps[0]!.data = { error: err instanceof Error ? err.message : String(err) };
      return {
        campaignId: "",
        adSetId: "",
        adId: null,
        steps,
        summary: `Failed at step 1: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 2: Create Ad Set
    steps.push({
      step: 2,
      name: "Create Ad Set",
      status: "pending",
      data: {},
    });

    let adSetId: string;
    try {
      const adSet = await this.provider.createAdSet({
        campaignId,
        name: params.adSetName ?? `${params.campaignName} - Ad Set`,
        dailyBudget: params.dailyBudget,
        targeting: params.targeting,
        optimizationGoal: params.optimizationGoal,
        status,
      });
      adSetId = adSet.id;
      steps[1]!.status = "completed";
      steps[1]!.data = { adSetId };
    } catch (err) {
      steps[1]!.status = "completed";
      steps[1]!.data = { error: err instanceof Error ? err.message : String(err) };
      return {
        campaignId,
        adSetId: "",
        adId: null,
        steps,
        summary: `Campaign created (${campaignId}) but ad set creation failed`,
      };
    }

    // Step 3: Create Ad
    steps.push({
      step: 3,
      name: "Create Ad",
      status: "pending",
      data: {},
    });

    let adId: string | null = null;
    try {
      const ad = await this.provider.createAd({
        adSetId,
        name: params.adName ?? `${params.campaignName} - Ad`,
        creative: params.creative,
        status,
      });
      adId = ad.id;
      steps[2]!.status = "completed";
      steps[2]!.data = { adId };
    } catch (err) {
      steps[2]!.status = "completed";
      steps[2]!.data = { error: err instanceof Error ? err.message : String(err) };
      return {
        campaignId,
        adSetId,
        adId: null,
        steps,
        summary: `Campaign and ad set created, but ad creation failed`,
      };
    }

    return {
      campaignId,
      adSetId,
      adId,
      steps,
      summary: `Full campaign setup complete: campaign ${campaignId}, ad set ${adSetId}, ad ${adId}`,
    };
  }
}
