import type { CartridgeInterceptor, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type { MetaAdsProvider } from "../providers/meta-ads.js";

const VERIFICATION_RETRIES = 3;
const VERIFICATION_DELAY_MS = 1000;

/**
 * Post-mutation verification interceptor.
 * After a successful write (pause/resume/budget), polls getCampaign()
 * to confirm the mutation took effect.
 */
export class PostMutationVerifier implements CartridgeInterceptor {
  constructor(private getProvider: () => MetaAdsProvider) {}

  async afterExecute(
    actionType: string,
    parameters: Record<string, unknown>,
    result: ExecuteResult,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    if (!result.success) return result;

    const campaignId = parameters["campaignId"] as string | undefined;
    if (!campaignId) return result;

    const expected = this.getExpectedState(actionType, parameters);
    if (!expected) return result;

    const verified = await this.pollForState(campaignId, expected);

    return {
      ...result,
      summary: verified
        ? `${result.summary} [verified]`
        : `${result.summary} [verification pending]`,
      externalRefs: {
        ...result.externalRefs,
        verificationStatus: verified ? "confirmed" : "unconfirmed",
      },
    };
  }

  private getExpectedState(
    actionType: string,
    parameters: Record<string, unknown>,
  ): { field: "status" | "dailyBudget"; value: string | number } | null {
    switch (actionType) {
      case "ads.campaign.pause":
        return { field: "status", value: "PAUSED" };
      case "ads.campaign.resume":
        return { field: "status", value: "ACTIVE" };
      case "ads.budget.adjust": {
        const newBudget = parameters["newBudget"] as number | undefined;
        if (newBudget !== undefined) {
          return { field: "dailyBudget", value: newBudget * 100 }; // cents
        }
        return null;
      }
      default:
        return null;
    }
  }

  private async pollForState(
    campaignId: string,
    expected: { field: "status" | "dailyBudget"; value: string | number },
  ): Promise<boolean> {
    const provider = this.getProvider();
    for (let i = 0; i < VERIFICATION_RETRIES; i++) {
      await this.delay(VERIFICATION_DELAY_MS);
      try {
        const campaign = await provider.getCampaign(campaignId);
        if (campaign[expected.field] === expected.value) {
          return true;
        }
      } catch {
        // Verification failure shouldn't block the result
      }
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
