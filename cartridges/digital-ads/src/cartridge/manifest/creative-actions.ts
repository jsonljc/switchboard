// Creative management and testing action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const creativeActions: readonly ActionDefinition[] = [
  {
    actionType: "digital-ads.creative.upload",
    name: "Upload Creative",
    description: "Upload a new ad creative to the ad account.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId", "creative"],
      properties: {
        adAccountId: { type: "string" },
        creative: { type: "object", description: "Creative specification" },
      },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.list",
    name: "List Creatives",
    description: "List ad creatives for an ad account.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId"],
      properties: {
        adAccountId: { type: "string" },
        limit: { type: "number" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.analyze",
    name: "Analyze Creatives",
    description: "Analyze creative performance — top/bottom performers, fatigue, format mix.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId"],
      properties: {
        adAccountId: { type: "string" },
        datePreset: { type: "string" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.rotate",
    name: "Rotate Creatives",
    description: "Execute creative rotation — pause fatigued ads and activate replacements.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId"],
      properties: {
        adAccountId: { type: "string" },
        minSpendThreshold: { type: "number" },
      },
    },
    baseRiskCategory: "high",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.generate",
    name: "Generate Creative Variants",
    description: "Generate ad creative text variants using the creative variant generator.",
    parametersSchema: {
      type: "object",
      required: ["productDescription", "targetAudience"],
      properties: {
        productDescription: { type: "string" },
        targetAudience: { type: "string" },
        angles: { type: "array", items: { type: "string" } },
        variantsPerAngle: { type: "number" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.score_assets",
    name: "Score Creative Assets",
    description:
      "Score creative assets by combining pre-computed vision model outputs (visual attributes) with performance data. Returns per-asset scores across 5 dimensions (performance, engagement, creative quality, fatigue, format), letter grades, strengths/weaknesses, and portfolio-level insights including attribute correlations and diversity scoring.",
    parametersSchema: {
      type: "object",
      required: ["accountId", "assets"],
      properties: {
        accountId: { type: "string", description: "Ad account ID" },
        assets: {
          type: "array",
          description:
            "Array of asset performance data objects (adId, adName, assetType, impressions, clicks, conversions, spend, ctr, cpa, frequency, and optional video metrics)",
        },
        visualAttributes: {
          type: "object",
          description:
            "Map of adId to visual attributes (pre-computed by vision model). Keys are adId strings, values are VisualAttributes objects.",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.generate_brief",
    name: "Generate Creative Brief",
    description:
      "Generate an actionable creative brief based on top-performing assets and identified weaknesses. Returns recommended formats, visual guidelines, copy guidelines, CTA recommendations, avoid list, and example references.",
    parametersSchema: {
      type: "object",
      required: ["topPerformers"],
      properties: {
        topPerformers: {
          type: "array",
          description:
            "Array of AssetScore objects from score_assets results (top performers to model the brief after)",
        },
        weaknesses: {
          type: "array",
          items: { type: "string" },
          description: "Array of weakness strings to address in the brief",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.power_calculate",
    name: "Power Calculator",
    description:
      "Calculate required sample size, estimated duration, and budget for a creative test given baseline conversion rate and minimum detectable effect.",
    parametersSchema: {
      type: "object",
      required: ["baselineRate", "minimumDetectableEffect"],
      properties: {
        baselineRate: {
          type: "number",
          description: "Baseline conversion rate (e.g. 0.02 for 2%)",
        },
        minimumDetectableEffect: {
          type: "number",
          description: "Relative lift to detect (e.g. 0.10 for 10%)",
        },
        significanceLevel: { type: "number", description: "Alpha level (default: 0.05)" },
        power: { type: "number", description: "Statistical power (default: 0.80)" },
        numVariants: {
          type: "number",
          description: "Number of variants including control (default: 2)",
        },
        estimatedDailyTraffic: {
          type: "number",
          description: "Estimated daily impressions per variant (default: 1000)",
        },
        estimatedCPM: { type: "number", description: "Estimated CPM in dollars (default: 10)" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.test_queue",
    name: "List Creative Tests & Calendar",
    description:
      "List all creative tests and generate a week-by-week test calendar showing available/occupied slots.",
    parametersSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["queued", "running", "concluded", "cancelled"],
          description: "Filter by test status",
        },
        calendarWeeks: {
          type: "number",
          description: "Number of weeks to show in calendar (default: 8)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.test_evaluate",
    name: "Evaluate Creative Test",
    description:
      "Check a running creative test for statistical significance using chi-squared test with Wilson score confidence intervals.",
    parametersSchema: {
      type: "object",
      required: ["testId", "variantMetrics"],
      properties: {
        testId: { type: "string", description: "Test ID to evaluate" },
        variantMetrics: {
          type: "array",
          items: {
            type: "object",
            required: ["variantId", "impressions", "clicks", "conversions", "spend"],
            properties: {
              variantId: { type: "string" },
              impressions: { type: "number" },
              clicks: { type: "number" },
              conversions: { type: "number" },
              spend: { type: "number" },
            },
          },
          description: "Performance metrics for each variant",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.test_create",
    name: "Queue Creative Test",
    description:
      "Add a new creative test to the testing queue with hypothesis, variants, and scheduling.",
    parametersSchema: {
      type: "object",
      required: ["name", "hypothesis", "variants", "primaryMetric"],
      properties: {
        name: { type: "string", description: "Test name" },
        hypothesis: { type: "string", description: "What you're testing and why" },
        variants: {
          type: "array",
          items: {
            type: "object",
            required: ["variantId", "description"],
            properties: {
              variantId: { type: "string" },
              description: { type: "string" },
              adId: { type: "string", description: "Optional Meta ad ID" },
            },
          },
          description: "Test variants (minimum 2)",
        },
        primaryMetric: {
          type: "string",
          enum: ["cpa", "ctr", "conversion_rate", "roas"],
          description: "Primary metric to optimize",
        },
        scheduledStartDate: { type: "string", description: "When to start the test (ISO date)" },
        minBudgetPerVariant: { type: "number", description: "Minimum daily budget per variant" },
      },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "digital-ads.creative.test_conclude",
    name: "Conclude Creative Test",
    description: "Mark a creative test as concluded and record the winner.",
    parametersSchema: {
      type: "object",
      required: ["testId"],
      properties: {
        testId: { type: "string", description: "Test ID to conclude" },
      },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },
];
