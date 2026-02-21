import type { CartridgeManifest } from "@switchboard/schemas";

export const ADS_SPEND_MANIFEST: CartridgeManifest = {
  id: "ads-spend",
  name: "Ads Spend Management",
  version: "1.0.0",
  description: "Manage advertising spend across platforms (Meta Ads, Google Ads)",
  actions: [
    {
      actionType: "ads.campaign.pause",
      name: "Pause Campaign",
      description: "Pause an active advertising campaign",
      parametersSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["campaignId"],
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "ads.campaign.resume",
      name: "Resume Campaign",
      description: "Resume a paused advertising campaign",
      parametersSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
        },
        required: ["campaignId"],
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "ads.budget.adjust",
      name: "Adjust Budget",
      description: "Adjust the daily budget of a campaign",
      parametersSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
          newBudget: { type: "number" },
          currency: { type: "string" },
        },
        required: ["campaignId", "newBudget"],
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "ads.targeting.modify",
      name: "Modify Targeting",
      description: "Modify targeting parameters for a campaign or ad set",
      parametersSchema: {
        type: "object",
        properties: {
          adSetId: { type: "string" },
          targeting: { type: "object" },
        },
        required: ["adSetId", "targeting"],
      },
      baseRiskCategory: "high",
      reversible: false,
    },
  ],
  requiredConnections: ["meta-ads"],
  defaultPolicies: ["ads-spend-default"],
};
