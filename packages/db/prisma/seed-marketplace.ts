/* eslint-disable no-console */
import type { PrismaClient } from "@prisma/client";

const SALES_PIPELINE_AGENTS = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description:
      "Responds to inbound leads within 60 seconds. Qualifies through natural conversation.",
    taskCategories: ["lead-qualification"],
    metadata: { bundleSlug: "sales-pipeline-bundle", roleFocus: "leads" },
  },
  {
    name: "Sales Closer",
    slug: "sales-closer",
    description:
      "Takes qualified leads and closes them. Handles objections, builds urgency, confirms decisions.",
    taskCategories: ["sales-closing"],
    metadata: { bundleSlug: "sales-pipeline-bundle", roleFocus: "growth" },
  },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description:
      "Re-engages cold leads through scheduled follow-ups. Varies approach across cadence.",
    taskCategories: ["lead-nurturing"],
    metadata: { bundleSlug: "sales-pipeline-bundle", roleFocus: "care" },
  },
];

const SALES_PIPELINE_BUNDLE = {
  name: "Sales Pipeline Bundle",
  slug: "sales-pipeline-bundle",
  description:
    "All three sales agents working as one team. Automatic handoffs, shared conversation context.",
  taskCategories: ["lead-qualification", "sales-closing", "lead-nurturing"],
};

const FUTURE_FAMILIES = [
  {
    name: "Creative",
    slug: "creative-family",
    description: "Content, social media, ad copy. Coming soon.",
    metadata: { isBundle: true, family: "creative" },
  },
  {
    name: "Trading",
    slug: "trading-family",
    description: "Market analysis, alerts, execution. Coming soon.",
    metadata: { isBundle: true, family: "trading" },
  },
  {
    name: "Finance",
    slug: "finance-family",
    description: "Bookkeeping, invoicing, expenses. Coming soon.",
    metadata: { isBundle: true, family: "finance" },
  },
];

export async function seedMarketplace(prisma: PrismaClient): Promise<void> {
  const agentIds: string[] = [];

  for (const agent of SALES_PIPELINE_AGENTS) {
    const listing = await prisma.agentListing.upsert({
      where: { slug: agent.slug },
      update: {
        name: agent.name,
        description: agent.description,
        taskCategories: agent.taskCategories,
        metadata: agent.metadata,
      },
      create: {
        ...agent,
        type: "switchboard_native",
        status: "listed",
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        priceMonthly: 0,
      },
    });
    agentIds.push(listing.id);
    console.warn(`  Seeded listing: ${agent.name} (${listing.id})`);
  }

  const bundle = await prisma.agentListing.upsert({
    where: { slug: SALES_PIPELINE_BUNDLE.slug },
    update: {
      name: SALES_PIPELINE_BUNDLE.name,
      description: SALES_PIPELINE_BUNDLE.description,
      metadata: { isBundle: true, family: "sales", bundleListingIds: agentIds },
    },
    create: {
      ...SALES_PIPELINE_BUNDLE,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
      metadata: { isBundle: true, family: "sales", bundleListingIds: agentIds },
    },
  });
  console.warn(`  Seeded bundle: ${SALES_PIPELINE_BUNDLE.name} (${bundle.id})`);

  for (const family of FUTURE_FAMILIES) {
    const listing = await prisma.agentListing.upsert({
      where: { slug: family.slug },
      update: { name: family.name, description: family.description, metadata: family.metadata },
      create: {
        ...family,
        type: "switchboard_native",
        status: "pending_review",
        taskCategories: [],
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        priceMonthly: 0,
      },
    });
    console.warn(`  Seeded placeholder: ${family.name} (${listing.id})`);
  }
}
