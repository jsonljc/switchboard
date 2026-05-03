#!/usr/bin/env npx tsx
/**
 * Seed one canned recommendation per agent into the dev DB so the console
 * can render the queue without running a full ad-optimizer audit.
 *
 * Usage:
 *   npx tsx scripts/seed-recommendation.ts <orgId>
 *
 * Reads DATABASE_URL from .env.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaRecommendationStore } from "@switchboard/db";
import { emitRecommendation } from "@switchboard/core";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("Usage: npx tsx scripts/seed-recommendation.ts <orgId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const store = new PrismaRecommendationStore(prisma);

  const fixtures = [
    {
      agentKey: "nova" as const,
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Pause Whitening Ad Set B — CPA $42 vs target $30",
      confidence: 0.92,
      dollarsAtRisk: 25,
      riskLevel: "low" as const,
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [["CPA $42 vs target $30"], ["7-day spend $1,240"]] as unknown[],
      },
      targetEntities: { campaignId: "seed-c-1", campaignName: "Whitening Ad Set B" },
    },
    {
      agentKey: "alex" as const,
      intent: "recommendation.escalate_lead",
      action: "escalate",
      humanSummary: "Escalate angry lead — Sarah K. (3 negative messages)",
      confidence: 0.78,
      dollarsAtRisk: 150,
      riskLevel: "medium" as const,
      parameters: {},
      presentation: {
        primaryLabel: "Reply now",
        secondaryLabel: "Schedule callback",
        dismissLabel: "Dismiss",
        dataLines: [["3 negative messages in last 10 minutes"]] as unknown[],
      },
      targetEntities: { contactId: "seed-contact-1" },
    },
    {
      agentKey: "mira" as const,
      intent: "recommendation.creative_retry",
      action: "add_creative",
      humanSummary: "Add fresh creatives to Recovery Ad Set — fatigue rising",
      confidence: 0.84,
      dollarsAtRisk: 0,
      riskLevel: "low" as const,
      parameters: {},
      presentation: {
        primaryLabel: "Add creatives",
        secondaryLabel: "Adjust later",
        dismissLabel: "Dismiss",
        dataLines: [["frequency 3.4 (target < 2.5)"]] as unknown[],
      },
      targetEntities: { campaignId: "seed-c-2" },
    },
  ];

  for (const f of fixtures) {
    const result = await emitRecommendation(store, { orgId, ...f });
    console.warn(`[seed] ${f.agentKey} → ${result.surface} ${result.id ?? ""}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
