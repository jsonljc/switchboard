import { randomUUID } from "node:crypto";
import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
  ResolvedEntity,
} from "@switchboard/schemas";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import { ADS_SPEND_MANIFEST } from "./manifest.js";
import type { MetaAdsProvider, MetaAdsConfig, CampaignInfo } from "./providers/meta-ads.js";
import { createMetaAdsProvider } from "./providers/factory.js";
import { DEFAULT_ADS_GUARDRAILS } from "./defaults/guardrails.js";
import {
  computeAdsBudgetRiskInput,
  computeAdsPauseRiskInput,
  computeAdsTargetingRiskInput,
} from "./risk/categories.js";
import {
  buildPauseUndoRecipe,
  buildResumeUndoRecipe,
  buildBudgetUndoRecipe,
} from "./actions/index.js";

export class AdsSpendCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = ADS_SPEND_MANIFEST;
  private provider: MetaAdsProvider | null = null;

  async initialize(context: CartridgeContext): Promise<void> {
    const config: MetaAdsConfig = {
      accessToken: context.connectionCredentials["accessToken"] as string,
      adAccountId: context.connectionCredentials["adAccountId"] as string,
    };
    this.provider = createMetaAdsProvider(config);
  }

  getProvider(): MetaAdsProvider {
    if (!this.provider) throw new Error("Cartridge not initialized");
    return this.provider;
  }

  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    return this.getProvider().searchCampaigns(query);
  }

  async enrichContext(
    _actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const provider = this.getProvider();
    const campaignId = (parameters["campaignId"] ?? parameters["adSetId"]) as string | undefined;
    if (!campaignId) return {};

    const campaign = await provider.getCampaign(campaignId);
    return {
      currentBudget: campaign.dailyBudget / 100,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      deliveryStatus: campaign.deliveryStatus,
      objective: campaign.objective,
    };
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    const provider = this.getProvider();
    const start = Date.now();

    switch (actionType) {
      case "ads.campaign.pause": {
        const campaignId = parameters["campaignId"] as string;
        const result = await provider.pauseCampaign(campaignId);
        return {
          success: result.success,
          summary: `Campaign ${campaignId} paused (was ${result.previousStatus})`,
          externalRefs: { campaignId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildPauseUndoRecipe(
            campaignId,
            parameters["_envelopeId"] as string ?? "unknown",
            parameters["_actionId"] as string ?? "unknown",
            result.previousStatus,
          ),
        };
      }

      case "ads.campaign.resume": {
        const campaignId = parameters["campaignId"] as string;
        await provider.resumeCampaign(campaignId);
        return {
          success: true,
          summary: `Campaign ${campaignId} resumed`,
          externalRefs: { campaignId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildResumeUndoRecipe(
            campaignId,
            parameters["_envelopeId"] as string ?? "unknown",
            parameters["_actionId"] as string ?? "unknown",
          ),
        };
      }

      case "ads.budget.adjust": {
        const campaignId = parameters["campaignId"] as string;
        let newBudget = parameters["newBudget"] as number | undefined;
        if (newBudget === undefined) {
          const budgetChange = parameters["budgetChange"] as number | undefined;
          if (budgetChange !== undefined) {
            const current = await provider.getCampaign(campaignId);
            newBudget = current.dailyBudget / 100 + budgetChange;
          }
        }
        if (newBudget === undefined || isNaN(newBudget)) {
          return {
            success: false,
            summary: `Missing budget value for campaign ${campaignId}`,
            externalRefs: { campaignId },
            rollbackAvailable: false,
            partialFailures: [{ step: "execute", error: "newBudget or budgetChange required" }],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        }
        const result = await provider.updateBudget(campaignId, newBudget * 100);
        return {
          success: result.success,
          summary: `Budget for campaign ${campaignId} updated: $${result.previousBudget / 100} -> $${newBudget}`,
          externalRefs: { campaignId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: buildBudgetUndoRecipe(
            campaignId,
            parameters["_envelopeId"] as string ?? "unknown",
            parameters["_actionId"] as string ?? "unknown",
            result.previousBudget / 100,
          ),
        };
      }

      default:
        return {
          success: false,
          summary: `Unknown action type: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "execute", error: `Unknown action type: ${actionType}` }],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
    }
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<RiskInput> {
    const provider = this.getProvider();
    const campaignId = (parameters["campaignId"] ?? parameters["adSetId"]) as string | undefined;

    if (!campaignId) {
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    }

    const campaign = await provider.getCampaign(campaignId);

    switch (actionType) {
      case "ads.budget.adjust":
        return computeAdsBudgetRiskInput(
          { campaignId, newBudget: parameters["newBudget"] as number },
          campaign,
        );
      case "ads.campaign.pause":
      case "ads.campaign.resume":
        return computeAdsPauseRiskInput(campaign);
      case "ads.targeting.modify":
        return computeAdsTargetingRiskInput(campaign, 10000);
      default:
        return {
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 0, blastRadius: 1 },
          reversibility: "full",
          sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
        };
    }
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_ADS_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return this.getProvider().healthCheck();
  }

  async resolveEntity(
    inputRef: string,
    entityType: string,
    _context: Record<string, unknown>,
  ): Promise<ResolvedEntity> {
    const provider = this.getProvider();
    const campaigns = await provider.searchCampaigns(inputRef);

    if (campaigns.length === 0) {
      return {
        id: `resolve_${randomUUID()}`,
        inputRef,
        resolvedType: entityType,
        resolvedId: "",
        resolvedName: "",
        confidence: 0,
        alternatives: [],
        status: "not_found",
      };
    }

    if (campaigns.length === 1) {
      const c = campaigns[0]!;
      return {
        id: `resolve_${randomUUID()}`,
        inputRef,
        resolvedType: entityType,
        resolvedId: c.id,
        resolvedName: c.name,
        confidence: 0.95,
        alternatives: [],
        status: "resolved",
      };
    }

    // Multiple matches -> ambiguous
    const best = campaigns[0]!;
    return {
      id: `resolve_${randomUUID()}`,
      inputRef,
      resolvedType: entityType,
      resolvedId: best.id,
      resolvedName: best.name,
      confidence: 0.5,
      alternatives: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        score: 0.5,
      })),
      status: "ambiguous",
    };
  }
}

export { ADS_SPEND_MANIFEST } from "./manifest.js";
export { DEFAULT_ADS_GUARDRAILS } from "./defaults/guardrails.js";
export { DEFAULT_ADS_POLICIES } from "./defaults/policies.js";
