import type { CartridgeReadAdapter } from "@switchboard/core";
import { AllowedIntent } from "./types.js";
import type { ReadIntentDescriptor } from "./types.js";
import {
  composePerformanceReport,
  composeCampaignStatus,
  composeRecommendations,
} from "./composers.js";

export interface ReadHandlerDeps {
  readAdapter: CartridgeReadAdapter;
  cartridgeId: string;
  actorId: string;
  organizationId?: string | null;
}

export interface ReadHandlerResult {
  text: string;
  traceId: string;
}

/**
 * Dispatches read-only intents to CartridgeReadAdapter and formats the result
 * as a Telegram message via the clinic composers.
 *
 * Every read is automatically audit-logged by CartridgeReadAdapter.query().
 */
export async function handleReadIntent(
  readIntent: ReadIntentDescriptor,
  deps: ReadHandlerDeps,
): Promise<ReadHandlerResult> {
  const { readAdapter, cartridgeId, actorId, organizationId } = deps;

  switch (readIntent.intent) {
    case AllowedIntent.REPORT_PERFORMANCE: {
      const result = await readAdapter.query({
        cartridgeId,
        operation: "searchCampaigns",
        parameters: {
          query: (readIntent.slots["campaignRef"] as string) ?? "",
        },
        actorId,
        organizationId,
      });
      return {
        text: composePerformanceReport(result.data),
        traceId: result.traceId,
      };
    }

    case AllowedIntent.CHECK_STATUS: {
      const campaignRef = readIntent.slots["campaignRef"] as string | undefined;

      // If a specific campaign is referenced, search for it; otherwise list all
      const result = await readAdapter.query({
        cartridgeId,
        operation: "searchCampaigns",
        parameters: { query: campaignRef ?? "" },
        actorId,
        organizationId,
      });

      // If they asked about a specific campaign, show status card; otherwise report
      if (campaignRef) {
        return {
          text: composeCampaignStatus(result.data),
          traceId: result.traceId,
        };
      }
      return {
        text: composePerformanceReport(result.data),
        traceId: result.traceId,
      };
    }

    case AllowedIntent.MORE_LEADS:
    case AllowedIntent.REDUCE_COST: {
      const result = await readAdapter.query({
        cartridgeId,
        operation: "searchCampaigns",
        parameters: { query: "" },
        actorId,
        organizationId,
      });
      return {
        text: composeRecommendations(readIntent.intent, result.data),
        traceId: result.traceId,
      };
    }

    default:
      return {
        text: "I don't know how to handle that request. Type \"help\" for available commands.",
        traceId: "",
      };
  }
}
