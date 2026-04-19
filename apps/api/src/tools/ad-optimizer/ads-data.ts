import type { SkillTool, GovernanceTier } from "@switchboard/core/skill-runtime";
import { parseLeadWebhook } from "@switchboard/ad-optimizer";

interface AdsDataDeps {
  adsClient: {
    getCampaignInsights(params: {
      dateRange: { since: string; until: string };
      fields: string[];
    }): Promise<unknown[]>;
    getAdSetInsights?(params: {
      dateRange: { since: string; until: string };
      fields: string[];
    }): Promise<unknown[]>;
    getAccountSummary(): Promise<unknown>;
  };
  capiClient: {
    dispatchEvent(params: unknown): Promise<unknown>;
  };
}

export function createAdsDataTool(deps: AdsDataDeps): SkillTool {
  return {
    id: "ads-data",
    operations: {
      "get-campaign-insights": {
        description: "Fetch campaign performance insights from Meta Ads API for a date range.",
        effectCategory: "read" as GovernanceTier,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            dateRange: {
              type: "object",
              properties: {
                since: { type: "string", description: "Start date (YYYY-MM-DD)" },
                until: { type: "string", description: "End date (YYYY-MM-DD)" },
              },
              required: ["since", "until"],
            },
            fields: {
              type: "array",
              items: { type: "string" },
              description: "Metrics to fetch (e.g., campaign_id, spend, impressions)",
            },
          },
          required: ["dateRange", "fields"],
        },
        execute: async (params: unknown) => {
          const { dateRange, fields } = params as {
            dateRange: { since: string; until: string };
            fields: string[];
          };
          const insights = await deps.adsClient.getCampaignInsights({ dateRange, fields });
          return { insights };
        },
      },

      "get-account-summary": {
        description: "Fetch account-level summary metrics from Meta Ads API.",
        effectCategory: "read" as GovernanceTier,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => deps.adsClient.getAccountSummary(),
      },

      "send-conversion-event": {
        description:
          "Send a conversion event to Meta CAPI. External write — requires governance approval.",
        effectCategory: "external_send" as GovernanceTier,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            eventName: { type: "string", description: "Event type (e.g., Lead, Purchase)" },
            eventTime: { type: "number", description: "Unix timestamp" },
            userData: {
              type: "object",
              description: "User data (email, phone, etc.)",
            },
            customData: {
              type: "object",
              description: "Custom event data",
            },
          },
          required: ["eventName", "eventTime"],
        },
        execute: async (params: unknown) => deps.capiClient.dispatchEvent(params),
      },

      "parse-lead-webhook": {
        description: "Parse a Meta lead webhook payload into structured lead data.",
        effectCategory: "read" as GovernanceTier,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            payload: {
              type: "object",
              description: "Meta webhook payload containing leadgen data",
            },
          },
          required: ["payload"],
        },
        execute: async (params: unknown) => {
          const { payload } = params as { payload: unknown };
          return parseLeadWebhook(payload);
        },
      },
    },
  };
}
