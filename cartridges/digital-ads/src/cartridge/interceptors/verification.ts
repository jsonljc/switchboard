// ---------------------------------------------------------------------------
// PostMutationVerifier — CartridgeInterceptor (SDK-compatible)
// ---------------------------------------------------------------------------
// After a write action executes, polls the API to verify the state change
// took effect. Appends verification status to the result.
// ---------------------------------------------------------------------------

import type {
  CartridgeInterceptor,
  CartridgeContext,
  ExecuteResult,
} from "@switchboard/cartridge-sdk";
import type { MetaAdsWriteProvider } from "../types.js";

export class PostMutationVerifier implements CartridgeInterceptor {
  private provider: MetaAdsWriteProvider;
  private maxRetries: number;

  constructor(provider: MetaAdsWriteProvider, maxRetries = 3) {
    this.provider = provider;
    this.maxRetries = maxRetries;
  }

  async afterExecute(
    actionType: string,
    _parameters: Record<string, unknown>,
    result: ExecuteResult,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    if (!result.success) return result;

    const campaignId = result.externalRefs["campaignId"];
    const adSetId = result.externalRefs["adSetId"];

    // Only verify write mutations that have an entity ID
    if (!campaignId && !adSetId) return result;

    try {
      const verified = await this.pollForVerification(actionType, result);
      if (verified) {
        return {
          ...result,
          summary: result.summary + " [verified]",
          externalRefs: { ...result.externalRefs, verificationStatus: "confirmed" },
        };
      } else {
        return {
          ...result,
          summary: result.summary + " [verification pending]",
          externalRefs: { ...result.externalRefs, verificationStatus: "unconfirmed" },
        };
      }
    } catch {
      return {
        ...result,
        summary: result.summary + " [verification pending]",
        externalRefs: { ...result.externalRefs, verificationStatus: "unconfirmed" },
      };
    }
  }

  private async pollForVerification(actionType: string, result: ExecuteResult): Promise<boolean> {
    for (let i = 0; i < this.maxRetries; i++) {
      await this.delay(1000);

      const campaignId = result.externalRefs["campaignId"];
      const adSetId = result.externalRefs["adSetId"];

      switch (actionType) {
        case "digital-ads.campaign.pause": {
          if (!campaignId) return false;
          const c = await this.provider.getCampaign(campaignId);
          if (c.status === "PAUSED") return true;
          break;
        }
        case "digital-ads.campaign.resume": {
          if (!campaignId) return false;
          const c = await this.provider.getCampaign(campaignId);
          if (c.status === "ACTIVE") return true;
          break;
        }
        case "digital-ads.campaign.adjust_budget": {
          if (!campaignId) return false;
          const c = await this.provider.getCampaign(campaignId);
          const expectedCents = Number(result.externalRefs["newBudget"]) * 100;
          if (c.dailyBudget === expectedCents) return true;
          break;
        }
        case "digital-ads.adset.pause": {
          if (!adSetId) return false;
          const a = await this.provider.getAdSet(adSetId);
          if (a.status === "PAUSED") return true;
          break;
        }
        case "digital-ads.adset.resume": {
          if (!adSetId) return false;
          const a = await this.provider.getAdSet(adSetId);
          if (a.status === "ACTIVE") return true;
          break;
        }
        case "digital-ads.adset.adjust_budget": {
          if (!adSetId) return false;
          const a = await this.provider.getAdSet(adSetId);
          const expectedCents = Number(result.externalRefs["newBudget"]) * 100;
          if (a.dailyBudget === expectedCents) return true;
          break;
        }
        default:
          return false;
      }
    }
    return false;
  }

  /* istanbul ignore next -- simple timer */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
