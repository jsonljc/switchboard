/* eslint-disable no-console */
/* eslint-disable max-lines */
import type { PrismaClient } from "@prisma/client";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { DEMO_CONVERSATIONS } from "./fixtures/demo-conversations.js";
import { seedDemoKnowledge } from "./fixtures/demo-knowledge.js";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "../src/seed/medspa-governance-config.js";

const GLOW_BUSINESS_FACTS = BusinessFactsSchema.parse({
  businessName: "Glow Aesthetics",
  timezone: "Asia/Singapore",
  locations: [
    {
      name: "Glow Aesthetics — Orchard",
      address: "391 Orchard Road, #14-05 Ngee Ann City, Singapore 238872",
      parkingNotes:
        "Paid parking at Ngee Ann City basement; 2 hours complimentary with validation at reception.",
      accessNotes: "Take the Tower B lift to level 14; we are immediately on the right.",
    },
  ],
  openingHours: {
    monday: { open: "10:00", close: "20:00", closed: false },
    tuesday: { open: "10:00", close: "20:00", closed: false },
    wednesday: { open: "10:00", close: "20:00", closed: false },
    thursday: { open: "10:00", close: "20:00", closed: false },
    friday: { open: "10:00", close: "21:00", closed: false },
    saturday: { open: "10:00", close: "18:00", closed: false },
    sunday: { open: "00:00", close: "00:00", closed: true },
  },
  services: [
    {
      name: "Anti-wrinkle injections (Botox)",
      description: "Softens forehead lines, frown lines and crow's feet.",
      durationMinutes: 30,
      price: "from $18/unit (typically 20–40 units)",
      currency: "SGD",
      bookingBehavior: "consultation_only",
      consultationRequired: true,
      idealFor: "Dynamic wrinkles from facial expression.",
      prepInstructions: "Avoid alcohol and blood thinners for 24 hours beforehand.",
      aftercareNotes: "Stay upright for 4 hours; no strenuous exercise for 24 hours.",
    },
    {
      name: "HydraFacial",
      description: "Medical-grade cleanse, exfoliation and hydration.",
      durationMinutes: 45,
      price: "$280",
      currency: "SGD",
      bookingBehavior: "book_directly",
      idealFor: "Dull or congested skin; great for first-time visitors.",
    },
    {
      name: "Dermal fillers",
      description: "Restores volume to cheeks, lips and nasolabial folds.",
      durationMinutes: 45,
      price: "from $700/syringe",
      currency: "SGD",
      bookingBehavior: "consultation_only",
      consultationRequired: true,
    },
  ],
  bookingPolicies: {
    cancellationPolicy: "Cancel or reschedule at least 24 hours ahead to avoid a charge.",
    reschedulePolicy: "One complimentary reschedule with 24 hours notice.",
    noShowPolicy: "No-shows are charged 50% of the treatment price.",
    advanceBookingDays: 60,
    prepInstructions: "Arrive 10 minutes early to complete a short medical-history form.",
  },
  escalationContact: {
    name: "Glow Aesthetics front desk",
    channel: "whatsapp",
    address: "+65 6555 0123",
  },
  additionalFaqs: [
    {
      question: "Do you offer first-visit consultations?",
      answer: "Yes — complimentary 15-minute consultations for new clients.",
    },
    {
      question: "Are treatments performed by licensed doctors?",
      answer: "All injectable treatments are performed by MOH-licensed doctors.",
    },
  ],
});

const SALES_PIPELINE_AGENTS = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description:
      "Responds to inbound leads within 60 seconds. Qualifies through natural conversation.",
    taskCategories: ["lead-qualification"],
    metadata: {
      bundleSlug: "sales-pipeline-bundle",
      roleFocus: "leads",
      family: "sales_pipeline",
      publicChannels: true,
      setupSchema: {
        onboarding: {
          websiteScan: true,
          publicChannels: true,
          privateChannel: false,
          integrations: [],
        },
        steps: [
          {
            id: "basics",
            title: "Agent Setup",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Conversation Tone",
                required: true,
                options: ["friendly", "professional", "casual"],
              },
              {
                key: "customInstructions",
                type: "textarea",
                label: "Custom Instructions",
                required: false,
              },
            ],
          },
        ],
      },
    },
  },
  {
    name: "Sales Closer",
    slug: "sales-closer",
    description:
      "Takes qualified leads and closes them. Handles objections, builds urgency, confirms decisions.",
    taskCategories: ["sales-closing"],
    metadata: {
      bundleSlug: "sales-pipeline-bundle",
      roleFocus: "growth",
      family: "sales_pipeline",
      publicChannels: true,
      setupSchema: {
        onboarding: {
          websiteScan: true,
          publicChannels: true,
          privateChannel: false,
          integrations: [],
        },
        steps: [
          {
            id: "basics",
            title: "Agent Setup",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Conversation Tone",
                required: true,
                options: ["friendly", "professional", "casual"],
              },
              {
                key: "bookingLink",
                type: "url",
                label: "Booking Link",
                required: true,
              },
              {
                key: "customInstructions",
                type: "textarea",
                label: "Custom Instructions",
                required: false,
              },
            ],
          },
        ],
      },
    },
  },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description:
      "Re-engages cold leads through scheduled follow-ups. Varies approach across cadence.",
    taskCategories: ["lead-nurturing"],
    metadata: {
      bundleSlug: "sales-pipeline-bundle",
      roleFocus: "care",
      family: "sales_pipeline",
      publicChannels: false,
      setupSchema: {
        onboarding: {
          websiteScan: true,
          publicChannels: false,
          privateChannel: false,
          integrations: [],
        },
        steps: [
          {
            id: "basics",
            title: "Agent Setup",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Conversation Tone",
                required: true,
                options: ["friendly", "professional", "casual"],
              },
              {
                key: "customInstructions",
                type: "textarea",
                label: "Custom Instructions",
                required: false,
              },
            ],
          },
        ],
      },
    },
  },
];

const SALES_PIPELINE_BUNDLE = {
  name: "Sales Pipeline Bundle",
  slug: "sales-pipeline-bundle",
  description:
    "All three sales agents working as one team. Automatic handoffs, shared conversation context.",
  taskCategories: ["lead-qualification", "sales-closing", "lead-nurturing"],
};

const AD_OPTIMIZER = {
  name: "Ad Optimizer",
  slug: "ad-optimizer",
  description:
    "Media strategist that diagnoses funnel leakage, compares period-over-period metrics, and recommends campaign actions. Connects to Meta Ads via OAuth. Builds draft campaigns but never publishes — human clicks publish.",
  taskCategories: ["audit", "recommendation", "draft_creation"],
  metadata: {
    isBundle: false,
    family: "paid_media",
    setupSchema: {
      onboarding: {
        websiteScan: false,
        publicChannels: false,
        privateChannel: false,
        integrations: ["meta-ads"],
      },
      steps: [
        {
          id: "ad-config",
          title: "Ad Account Settings",
          fields: [
            { key: "monthlyBudget", type: "text", label: "Monthly Ad Budget ($)", required: true },
            {
              key: "targetCPA",
              type: "text",
              label: "Target Cost Per Acquisition ($)",
              required: false,
            },
            { key: "targetROAS", type: "text", label: "Target ROAS (e.g., 3.0)", required: false },
            {
              key: "auditFrequency",
              type: "select",
              label: "Audit Frequency",
              required: true,
              options: ["weekly", "daily"],
              default: "weekly",
            },
            {
              key: "pixelId",
              type: "text",
              label: "Meta Pixel ID (for CAPI)",
              required: false,
              hint: "Found in Events Manager → Data Sources",
            },
          ],
        },
      ],
    },
  },
};

const PERFORMANCE_CREATIVE_DIRECTOR = {
  name: "Performance Creative Director",
  slug: "performance-creative-director",
  description:
    "Full creative pipeline — from trend analysis and hooks to scripts, storyboards, and produced video ads. Stop at any stage.",
  taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"],
  metadata: {
    isBundle: false,
    family: "paid_media",
    stages: ["trends", "hooks", "scripts", "storyboard", "production"],
    setupSchema: {
      onboarding: {
        websiteScan: true,
        publicChannels: false,
        privateChannel: false,
        integrations: [],
      },
      steps: [
        {
          id: "basics",
          title: "Creative Setup",
          fields: [
            {
              key: "targetAudience",
              type: "textarea",
              label: "Target Audience",
              required: false,
              prefillFrom: "scannedProfile.description",
            },
            {
              key: "platforms",
              type: "select",
              label: "Ad Platforms",
              required: true,
              options: ["meta", "youtube", "tiktok"],
            },
            {
              key: "brandVoice",
              type: "textarea",
              label: "Brand Voice",
              required: false,
              prefillFrom: "scannedProfile.brandLanguage",
            },
          ],
        },
      ],
    },
  },
};

const WEBSITE_PROFILER = {
  name: "Website Profiler",
  slug: "website-profiler",
  description:
    "Scans a business website and extracts a structured profile — platform, contact info, services, pricing signals, and brand language. Results feed into other agents.",
  taskCategories: ["website-analysis"],
  metadata: {
    isBundle: false,
    family: "onboarding",
    setupSchema: {
      onboarding: {
        websiteScan: false,
        publicChannels: false,
        privateChannel: false,
        integrations: [],
      },
      steps: [
        {
          id: "basics",
          title: "Profiler Setup",
          fields: [
            {
              key: "targetUrl",
              type: "url",
              label: "Website URL to scan",
              required: true,
            },
          ],
        },
      ],
    },
  },
};

const ALEX_CONVERSION_AGENT = {
  name: "Alex — Frontline Conversion Agent",
  slug: "alex-conversion",
  description:
    "Responds to inbound leads instantly, qualifies through natural conversation, handles objections, and books appointments.",
  taskCategories: ["lead-qualification", "sales-closing", "booking"],
  metadata: {
    family: "sales_pipeline",
    publicChannels: true,
    setupSchema: {
      onboarding: {
        websiteScan: true,
        publicChannels: true,
        privateChannel: false,
        integrations: [],
      },
      steps: [
        {
          id: "basics",
          title: "Agent Setup",
          fields: [
            {
              key: "tone",
              type: "select",
              label: "Conversation Tone",
              required: true,
              options: ["friendly", "professional", "casual"],
            },
            {
              key: "bookingLink",
              type: "url",
              label: "Booking Link",
              required: true,
            },
            {
              key: "customInstructions",
              type: "textarea",
              label: "Custom Instructions",
              required: false,
            },
          ],
        },
      ],
    },
  },
};

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

  const bundleMetadata = {
    isBundle: true,
    family: "sales_pipeline",
    bundleListingIds: agentIds,
    setupSchema: {
      onboarding: {
        websiteScan: true,
        publicChannels: true,
        privateChannel: false,
        integrations: [],
      },
      steps: [
        {
          id: "basics",
          title: "Bundle Setup",
          fields: [
            {
              key: "tone",
              type: "select",
              label: "Conversation Tone",
              required: true,
              options: ["friendly", "professional", "casual"],
            },
            {
              key: "bookingLink",
              type: "url",
              label: "Booking Link",
              required: true,
            },
            {
              key: "customInstructions",
              type: "textarea",
              label: "Custom Instructions",
              required: false,
            },
          ],
        },
      ],
    },
  };

  const bundle = await prisma.agentListing.upsert({
    where: { slug: SALES_PIPELINE_BUNDLE.slug },
    update: {
      name: SALES_PIPELINE_BUNDLE.name,
      description: SALES_PIPELINE_BUNDLE.description,
      metadata: bundleMetadata,
    },
    create: {
      ...SALES_PIPELINE_BUNDLE,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
      metadata: bundleMetadata,
    },
  });
  console.warn(`  Seeded bundle: ${SALES_PIPELINE_BUNDLE.name} (${bundle.id})`);

  // Remove old placeholder that was renamed
  await prisma.agentListing.deleteMany({
    where: { slug: "creative-family" },
  });

  // Remove old trading/finance placeholders that have no backing code
  await prisma.agentListing.deleteMany({
    where: { slug: { in: ["trading-family", "finance-family"] } },
  });

  // Seed Performance Creative Director as a listed agent
  const pcd = await prisma.agentListing.upsert({
    where: { slug: PERFORMANCE_CREATIVE_DIRECTOR.slug },
    update: {
      name: PERFORMANCE_CREATIVE_DIRECTOR.name,
      description: PERFORMANCE_CREATIVE_DIRECTOR.description,
      taskCategories: PERFORMANCE_CREATIVE_DIRECTOR.taskCategories,
      metadata: PERFORMANCE_CREATIVE_DIRECTOR.metadata,
      status: "listed",
    },
    create: {
      ...PERFORMANCE_CREATIVE_DIRECTOR,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
    },
  });
  console.warn(`  Seeded listing: ${PERFORMANCE_CREATIVE_DIRECTOR.name} (${pcd.id})`);

  // Seed Ad Optimizer as a listed agent
  const adOptimizer = await prisma.agentListing.upsert({
    where: { slug: AD_OPTIMIZER.slug },
    update: {
      name: AD_OPTIMIZER.name,
      description: AD_OPTIMIZER.description,
      taskCategories: AD_OPTIMIZER.taskCategories,
      metadata: AD_OPTIMIZER.metadata,
      status: "listed",
    },
    create: {
      ...AD_OPTIMIZER,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
    },
  });
  console.warn(`  Seeded listing: ${AD_OPTIMIZER.name} (${adOptimizer.id})`);

  // Seed Website Profiler as a listed agent
  const profiler = await prisma.agentListing.upsert({
    where: { slug: WEBSITE_PROFILER.slug },
    update: {
      name: WEBSITE_PROFILER.name,
      description: WEBSITE_PROFILER.description,
      taskCategories: WEBSITE_PROFILER.taskCategories,
      metadata: WEBSITE_PROFILER.metadata,
      status: "listed",
    },
    create: {
      ...WEBSITE_PROFILER,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
    },
  });
  console.warn(`  Seeded listing: ${WEBSITE_PROFILER.name} (${profiler.id})`);

  // Seed Alex Conversion Agent as a listed agent
  const alex = await prisma.agentListing.upsert({
    where: { slug: ALEX_CONVERSION_AGENT.slug },
    update: {
      name: ALEX_CONVERSION_AGENT.name,
      description: ALEX_CONVERSION_AGENT.description,
      taskCategories: ALEX_CONVERSION_AGENT.taskCategories,
      metadata: ALEX_CONVERSION_AGENT.metadata,
      status: "listed",
    },
    create: {
      ...ALEX_CONVERSION_AGENT,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
    },
  });
  console.warn(`  Seeded listing: ${ALEX_CONVERSION_AGENT.name} (${alex.id})`);
}

/**
 * Seeds demo organization, deployments, tasks, and trust scores for marketplace landing page.
 */
export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  const ORG_ID = "org_demo";
  const now = new Date();

  // 1. Create demo organization
  await prisma.organizationConfig.upsert({
    where: { id: ORG_ID },
    update: {
      name: "Austin Bakery Co",
      runtimeType: "http",
      governanceProfile: "guarded",
      onboardingComplete: true,
      provisioningStatus: "active",
      businessHours: {
        timezone: "Asia/Singapore",
        days: [
          { day: 1, open: "09:00", close: "17:00" },
          { day: 2, open: "09:00", close: "17:00" },
          { day: 3, open: "09:00", close: "17:00" },
          { day: 4, open: "09:00", close: "17:00" },
          { day: 5, open: "09:00", close: "17:00" },
        ],
        defaultDurationMinutes: 30,
        bufferMinutes: 15,
        slotIncrementMinutes: 30,
      },
    },
    create: {
      id: ORG_ID,
      name: "Austin Bakery Co",
      runtimeType: "http",
      governanceProfile: "guarded",
      onboardingComplete: true,
      provisioningStatus: "active",
      businessHours: {
        timezone: "Asia/Singapore",
        days: [
          { day: 1, open: "09:00", close: "17:00" },
          { day: 2, open: "09:00", close: "17:00" },
          { day: 3, open: "09:00", close: "17:00" },
          { day: 4, open: "09:00", close: "17:00" },
          { day: 5, open: "09:00", close: "17:00" },
        ],
        defaultDurationMinutes: 30,
        bufferMinutes: 15,
        slotIncrementMinutes: 30,
      },
    },
  });
  console.warn(`  Created demo org: ${ORG_ID}`);

  // 2. Get all sales pipeline agent listings + Alex
  const listings = await prisma.agentListing.findMany({
    where: {
      slug: { in: ["speed-to-lead", "sales-closer", "nurture-specialist", "alex-conversion"] },
    },
  });

  const listingMap = new Map(listings.map((l) => [l.slug, l]));

  // 3. Create deployments for all 3 sales pipeline agents
  const deployments: { slug: string; id: string; listingId: string }[] = [];
  for (const agent of SALES_PIPELINE_AGENTS) {
    const listing = listingMap.get(agent.slug);
    if (!listing) {
      console.warn(`  WARNING: Listing not found for ${agent.slug}`);
      continue;
    }

    const deployment = await prisma.agentDeployment.upsert({
      where: {
        organizationId_listingId: {
          organizationId: ORG_ID,
          listingId: listing.id,
        },
      },
      update: {
        status: "active",
        skillSlug: "sales-pipeline",
        inputConfig: {
          businessName: "Austin Bakery Co",
          tone: "friendly",
          bookingLink: "https://cal.com/austin-bakery",
        },
        governanceSettings: {},
        connectionIds: [],
      },
      create: {
        organizationId: ORG_ID,
        listingId: listing.id,
        status: "active",
        skillSlug: "sales-pipeline",
        inputConfig: {
          businessName: "Austin Bakery Co",
          tone: "friendly",
          bookingLink: "https://cal.com/austin-bakery",
        },
        governanceSettings: {},
        connectionIds: [],
      },
    });
    deployments.push({ slug: agent.slug, id: deployment.id, listingId: listing.id });
    console.warn(`  Created deployment: ${agent.name} (${deployment.id})`);
  }

  // 4. Create Alex deployment with skillSlug
  const alexListing = listingMap.get("alex-conversion");
  if (alexListing) {
    const alexDeployment = await prisma.agentDeployment.upsert({
      where: {
        organizationId_listingId: {
          organizationId: ORG_ID,
          listingId: alexListing.id,
        },
      },
      update: {
        status: "active",
        skillSlug: "alex",
        inputConfig: {
          businessName: "Glow Aesthetics",
          businessType: "aesthetics_clinic",
          tone: "friendly",
          bookingLink: "https://cal.com/glow-aesthetics",
          qualificationCriteria: {
            ageRequirement: "21+",
            noContraindications: true,
          },
          disqualificationCriteria: {
            underage: true,
            activeInfection: true,
          },
          escalationRules: {
            medicalQuestions: true,
            pricingNegotiation: true,
            complaints: true,
          },
        },
        // SMB launch posture: auto-allow Alex's revenue-path tool calls (CRM
        // writes, bookings) without per-action approval. trustScore still rises
        // as earned confidence; this override only sets day-one friction.
        governanceSettings: { trustLevelOverride: "autonomous" },
        // Staged governance rollout: all four afterSkill gates + the pre-input
        // scanner run in observe (strictly log-only). Enforce is a deliberate
        // per-gate ops config update gated on the observe bake.
        governanceConfig: MEDSPA_PILOT_GOVERNANCE_CONFIG,
        connectionIds: [],
      },
      create: {
        organizationId: ORG_ID,
        listingId: alexListing.id,
        status: "active",
        skillSlug: "alex",
        inputConfig: {
          businessName: "Glow Aesthetics",
          businessType: "aesthetics_clinic",
          tone: "friendly",
          bookingLink: "https://cal.com/glow-aesthetics",
          qualificationCriteria: {
            ageRequirement: "21+",
            noContraindications: true,
          },
          disqualificationCriteria: {
            underage: true,
            activeInfection: true,
          },
          escalationRules: {
            medicalQuestions: true,
            pricingNegotiation: true,
            complaints: true,
          },
        },
        governanceSettings: { trustLevelOverride: "autonomous" },
        // Same staged observe posture as the update branch above.
        governanceConfig: MEDSPA_PILOT_GOVERNANCE_CONFIG,
        connectionIds: [],
      },
    });
    deployments.push({
      slug: "alex-conversion",
      id: alexDeployment.id,
      listingId: alexListing.id,
    });
    console.warn(`  Created deployment: ${ALEX_CONVERSION_AGENT.name} (${alexDeployment.id})`);
    await prisma.businessConfig.upsert({
      where: { organizationId: ORG_ID },
      update: { config: GLOW_BUSINESS_FACTS as object },
      create: { organizationId: ORG_ID, config: GLOW_BUSINESS_FACTS as object },
    });
    console.warn(`  Seeded BusinessConfig facts for ${ORG_ID}`);
  }

  // 5. Create website profiler deployment
  const profilerListing = await prisma.agentListing.findUnique({
    where: { slug: "website-profiler" },
  });
  if (profilerListing) {
    const profilerDeployment = await prisma.agentDeployment.upsert({
      where: {
        organizationId_listingId: {
          organizationId: ORG_ID,
          listingId: profilerListing.id,
        },
      },
      update: {
        status: "active",
        skillSlug: "website-profiler",
        inputConfig: {},
        governanceSettings: {},
        connectionIds: [],
      },
      create: {
        organizationId: ORG_ID,
        listingId: profilerListing.id,
        status: "active",
        skillSlug: "website-profiler",
        inputConfig: {},
        governanceSettings: {},
        connectionIds: [],
      },
    });
    console.warn(`  Created deployment: ${WEBSITE_PROFILER.name} (${profilerDeployment.id})`);
  }

  // 6. Create ad optimizer deployment
  const adOptimizerListing = await prisma.agentListing.findUnique({
    where: { slug: "ad-optimizer" },
  });
  if (adOptimizerListing) {
    const adOptDeployment = await prisma.agentDeployment.upsert({
      where: {
        organizationId_listingId: {
          organizationId: ORG_ID,
          listingId: adOptimizerListing.id,
        },
      },
      update: {
        status: "active",
        skillSlug: "ad-optimizer",
        inputConfig: {
          monthlyBudget: "3000",
          targetCPA: "30",
          targetROAS: "2.5",
          auditFrequency: "weekly",
        },
        // SMB launch posture: auto-allow Riley's reversible ad-optimization
        // actions without per-action approval (see Alex deployment above).
        governanceSettings: { trustLevelOverride: "autonomous" },
        connectionIds: [],
      },
      create: {
        organizationId: ORG_ID,
        listingId: adOptimizerListing.id,
        status: "active",
        skillSlug: "ad-optimizer",
        inputConfig: {
          monthlyBudget: "3000",
          targetCPA: "30",
          targetROAS: "2.5",
          auditFrequency: "weekly",
        },
        governanceSettings: { trustLevelOverride: "autonomous" },
        connectionIds: [],
      },
    });
    console.warn(`  Created deployment: ${AD_OPTIMIZER.name} (${adOptDeployment.id})`);
  }

  const deploymentMap = new Map(deployments.map((d) => [d.slug, d]));

  // 5. Delete existing demo tasks for clean re-seed
  const deleteResult = await prisma.agentTask.deleteMany({
    where: { organizationId: ORG_ID },
  });
  console.warn(`  Deleted ${deleteResult.count} existing demo tasks`);

  // 6. Track trust score progression per listing per category
  interface TrustScoreState {
    score: number;
    totalApprovals: number;
    totalRejections: number;
    consecutiveApprovals: number;
  }

  const trustScores = new Map<string, TrustScoreState>();

  function getTrustKey(listingId: string, category: string): string {
    return `${listingId}:${category}`;
  }

  function getOrInitTrust(listingId: string, category: string): TrustScoreState {
    const key = getTrustKey(listingId, category);
    if (!trustScores.has(key)) {
      trustScores.set(key, {
        score: 0,
        totalApprovals: 0,
        totalRejections: 0,
        consecutiveApprovals: 0,
      });
    }
    return trustScores.get(key)!;
  }

  function updateTrust(listingId: string, category: string, approved: boolean): void {
    const state = getOrInitTrust(listingId, category);

    if (approved) {
      state.totalApprovals += 1;
      state.consecutiveApprovals += 1;
      // Base +3, streak bonus up to +2 (0.5 per consecutive, capped)
      const streakBonus = Math.min(state.consecutiveApprovals * 0.5, 2);
      state.score += 3 + streakBonus;
    } else {
      state.totalRejections += 1;
      state.consecutiveApprovals = 0;
      state.score -= 10;
    }

    // Clamp to 0-100
    state.score = Math.max(0, Math.min(100, state.score));
  }

  // 7. Create tasks from DEMO_CONVERSATIONS
  let taskCount = 0;
  for (const conv of DEMO_CONVERSATIONS) {
    const deployment = deploymentMap.get(conv.agentSlug);
    if (!deployment) {
      console.warn(`  WARNING: Deployment not found for ${conv.agentSlug}`);
      continue;
    }

    // Calculate timestamps relative to now
    const createdAt = new Date(now.getTime() - conv.minutesAgo * 60 * 1000);
    const lastMessageOffset = Math.max(...conv.messages.map((m) => m.minutesOffset));
    const completedAt = new Date(createdAt.getTime() + lastMessageOffset * 60 * 1000);

    // Build output JSON with absolute timestamps
    const messagesWithTimestamps = conv.messages.map((msg) => ({
      role: msg.role,
      text: msg.text,
      timestamp: new Date(createdAt.getTime() + msg.minutesOffset * 60 * 1000).toISOString(),
    }));

    const output = {
      summary: conv.summary,
      outcome: conv.outcome,
      handoffTo: conv.handoffTo,
      messages: messagesWithTimestamps,
    };

    // Determine status based on reviewStatus
    const status = conv.reviewStatus;

    await prisma.agentTask.create({
      data: {
        deploymentId: deployment.id,
        organizationId: ORG_ID,
        listingId: deployment.listingId,
        category: conv.category,
        status,
        input: {},
        output,
        reviewResult: conv.reviewStatus === "approved" ? "approved" : "rejected",
        reviewedBy: "principal_dev",
        reviewedAt: completedAt,
        completedAt,
        createdAt,
      },
    });

    // Update trust score state
    updateTrust(deployment.listingId, conv.category, conv.reviewStatus === "approved");
    taskCount += 1;
  }
  console.warn(`  Created ${taskCount} demo tasks from fixtures`);

  // 8. Create/update TrustScoreRecord entries
  for (const [key, state] of trustScores.entries()) {
    const parts = key.split(":");
    const listingId = parts[0];
    const category = parts[1];
    if (!listingId || !category) {
      console.warn(`  WARNING: Invalid trust key: ${key}`);
      continue;
    }

    await prisma.trustScoreRecord.upsert({
      where: {
        listingId_taskCategory: {
          listingId,
          taskCategory: category,
        },
      },
      update: {
        score: state.score,
        totalApprovals: state.totalApprovals,
        totalRejections: state.totalRejections,
        consecutiveApprovals: state.consecutiveApprovals,
        lastActivityAt: now,
      },
      create: {
        listingId,
        taskCategory: category,
        score: state.score,
        totalApprovals: state.totalApprovals,
        totalRejections: state.totalRejections,
        consecutiveApprovals: state.consecutiveApprovals,
        lastActivityAt: now,
      },
    });
  }
  console.warn(`  Created/updated ${trustScores.size} trust score records`);

  // 9. Update listing trustScore and autonomyLevel based on aggregate scores
  for (const deployment of deployments) {
    const listing = listingMap.get(deployment.slug);
    if (!listing) continue;

    // Get all trust score records for this listing
    const records = await prisma.trustScoreRecord.findMany({
      where: { listingId: deployment.listingId },
    });

    if (records.length === 0) continue;

    // Calculate aggregate trust score (average across categories)
    const avgScore = records.reduce((sum, r) => sum + r.score, 0) / records.length;

    // Determine autonomy level
    let autonomyLevel = "supervised";
    if (avgScore >= 80) {
      autonomyLevel = "autonomous";
    } else if (avgScore >= 55) {
      autonomyLevel = "autonomous";
    } else if (avgScore >= 30) {
      autonomyLevel = "guided";
    }

    // Determine price tier
    let priceTier = "free";
    let priceMonthly = 0;
    if (avgScore >= 80) {
      priceTier = "elite";
      priceMonthly = 299;
    } else if (avgScore >= 55) {
      priceTier = "pro";
      priceMonthly = 149;
    } else if (avgScore >= 30) {
      priceTier = "basic";
      priceMonthly = 49;
    }

    await prisma.agentListing.update({
      where: { id: deployment.listingId },
      data: {
        trustScore: avgScore,
        autonomyLevel,
        priceTier,
        priceMonthly,
      },
    });

    console.warn(
      `  Updated listing ${deployment.slug}: trustScore=${avgScore.toFixed(1)}, autonomy=${autonomyLevel}, tier=${priceTier}`,
    );
  }

  // 10. Seed demo business knowledge for Glow Aesthetics
  await seedDemoKnowledge(prisma, ORG_ID);
}
