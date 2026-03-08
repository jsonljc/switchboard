// Memory, deduplication, geo-experiment, KPI, seasonal, and LTV action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const memoryGeoKpiActions: readonly ActionDefinition[] = [
  {
    actionType: "digital-ads.memory.insights",
    name: "Get Account Memory Insights",
    description:
      "Retrieve aggregated insights from historical optimization records for an account. Shows success rates, average impact, and recommendations per action type.",
    parametersSchema: {
      type: "object",
      required: ["accountId"],
      properties: {
        accountId: {
          type: "string",
          description: "The ad account ID to retrieve insights for",
        },
      },
    },
    baseRiskCategory: "none",
    reversible: true,
  },
  {
    actionType: "digital-ads.memory.list",
    name: "List Optimization Records",
    description:
      "List historical optimization records for an account with optional filtering by action type, entity, outcome status, and limit.",
    parametersSchema: {
      type: "object",
      required: ["accountId"],
      properties: {
        accountId: {
          type: "string",
          description: "The ad account ID",
        },
        actionType: {
          type: "string",
          description:
            "Filter by optimization action type (e.g. 'budget_increase', 'bid_strategy_change')",
        },
        entityId: {
          type: "string",
          description: "Filter by entity ID",
        },
        status: {
          type: "string",
          enum: ["positive", "negative", "neutral", "pending"],
          description: "Filter by outcome status",
        },
        limit: {
          type: "number",
          description: "Maximum number of records to return (default: all)",
        },
      },
    },
    baseRiskCategory: "none",
    reversible: true,
  },
  {
    actionType: "digital-ads.memory.recommend",
    name: "Get Memory-Based Recommendation",
    description:
      "Get a recommendation for a proposed optimization action based on historical performance data. Considers account-wide and entity-specific history, plus recent trends.",
    parametersSchema: {
      type: "object",
      required: ["accountId", "proposedAction"],
      properties: {
        accountId: {
          type: "string",
          description: "The ad account ID",
        },
        proposedAction: {
          type: "string",
          description:
            "The optimization action type being considered (e.g. 'budget_increase', 'creative_rotation')",
        },
        entityId: {
          type: "string",
          description: "Optional entity ID for entity-specific history lookup",
        },
      },
    },
    baseRiskCategory: "none",
    reversible: true,
  },
  {
    actionType: "digital-ads.memory.record",
    name: "Record Optimization Action",
    description:
      "Record a new optimization action with before-metrics. Creates a persistent record that can later be updated with outcome data.",
    parametersSchema: {
      type: "object",
      required: [
        "accountId",
        "actionType",
        "entityId",
        "entityType",
        "changeDescription",
        "parameters",
        "metricsBefore",
      ],
      properties: {
        accountId: {
          type: "string",
          description: "The ad account ID",
        },
        actionType: {
          type: "string",
          description:
            "The optimization action type (e.g. 'budget_increase', 'bid_strategy_change')",
        },
        entityId: {
          type: "string",
          description: "The entity that was modified",
        },
        entityType: {
          type: "string",
          enum: ["campaign", "adset", "ad", "account"],
          description: "The type of entity modified",
        },
        changeDescription: {
          type: "string",
          description: "Human-readable description of the change",
        },
        parameters: {
          type: "object",
          description: "Parameters of the change",
        },
        metricsBefore: {
          type: "object",
          description:
            "Metrics before the change (spend, conversions, cpa, roas, ctr, impressions)",
        },
        triggeringFinding: {
          type: "string",
          description: "The finding that triggered this action (if any)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "digital-ads.memory.record_outcome",
    name: "Record Optimization Outcome",
    description:
      "Update an existing optimization record with post-change metrics. Automatically computes the outcome (positive/negative/neutral) based on metric deltas.",
    parametersSchema: {
      type: "object",
      required: ["recordId", "metricsAfter"],
      properties: {
        recordId: {
          type: "string",
          description: "The optimization record ID to update",
        },
        metricsAfter: {
          type: "object",
          required: ["daysAfterChange"],
          properties: {
            spend: { type: "number" },
            conversions: { type: "number" },
            cpa: { type: "number" },
            roas: { type: "number" },
            ctr: { type: "number" },
            impressions: { type: "number" },
            daysAfterChange: {
              type: "number",
              description: "Number of days after the change that these metrics were captured",
            },
          },
          description: "Metrics after the change",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "digital-ads.memory.export",
    name: "Export Account Memory",
    description:
      "Export all optimization records for an account as a JSON string. Used for persistence by the orchestrator layer.",
    parametersSchema: {
      type: "object",
      required: ["accountId"],
      properties: {
        accountId: {
          type: "string",
          description: "The ad account ID to export memory for",
        },
      },
    },
    baseRiskCategory: "none",
    reversible: true,
  },
  {
    actionType: "digital-ads.memory.import",
    name: "Import Account Memory",
    description:
      "Import previously exported optimization records. Deduplicates by record ID — existing records are not overwritten.",
    parametersSchema: {
      type: "object",
      required: ["data"],
      properties: {
        data: {
          type: "string",
          description: "JSON string of exported memory data",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "digital-ads.deduplication.analyze",
    name: "Analyze Cross-Platform Deduplication",
    description:
      "Estimate deduplicated conversion totals across Meta, Google, and TikTok using probabilistic overlap estimation. Computes overcounting factor, blended CPA/ROAS, and per-platform adjusted shares. Accepts pre-fetched daily conversion data per platform.",
    parametersSchema: {
      type: "object",
      required: ["platforms"],
      properties: {
        platforms: {
          type: "array",
          description: "Per-platform conversion data (at least 2 required)",
          items: {
            type: "object",
            required: ["platform", "dailyData", "attributionWindow", "attributionModel"],
            properties: {
              platform: {
                type: "string",
                enum: ["meta", "google", "tiktok"],
                description: "Ad platform",
              },
              dailyData: {
                type: "array",
                description: "Daily conversion data points",
                items: {
                  type: "object",
                  required: ["date", "conversions", "revenue", "spend", "impressions", "clicks"],
                  properties: {
                    date: { type: "string", description: "Date (YYYY-MM-DD)" },
                    conversions: { type: "number" },
                    revenue: { type: "number" },
                    spend: { type: "number" },
                    impressions: { type: "number" },
                    clicks: { type: "number" },
                  },
                },
              },
              attributionWindow: {
                type: "string",
                enum: ["1d_click", "7d_click", "28d_click", "1d_view", "7d_click_1d_view"],
                description: "Attribution window used by this platform",
              },
              attributionModel: {
                type: "string",
                enum: ["last_click", "data_driven", "first_click", "linear", "time_decay"],
                description: "Attribution model used by this platform",
              },
            },
          },
        },
        config: {
          type: "object",
          description: "Optional overlap estimation configuration",
          properties: {
            method: {
              type: "string",
              enum: ["statistical", "time_decay", "hybrid"],
              description: "Overlap estimation method (default: hybrid)",
            },
            defaultOverlapRates: {
              type: "object",
              description:
                "Custom default overlap rates by platform pair (e.g. { 'meta+google': 0.20 })",
            },
            minDaysForStatistical: {
              type: "number",
              description: "Minimum days of data for statistical method (default: 14)",
            },
          },
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.deduplication.estimate_overlap",
    name: "Estimate Pairwise Platform Overlap",
    description:
      "Estimate the conversion overlap between two specific ad platforms. Returns overlap rate, estimated overlapping conversions, confidence level, and methodology used.",
    parametersSchema: {
      type: "object",
      required: ["platform1", "platform2"],
      properties: {
        platform1: {
          type: "object",
          description: "First platform's conversion data (PlatformConversionData)",
        },
        platform2: {
          type: "object",
          description: "Second platform's conversion data (PlatformConversionData)",
        },
        method: {
          type: "string",
          enum: ["statistical", "time_decay", "hybrid"],
          description: "Overlap estimation method (default: hybrid)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.geo_experiment.design",
    name: "Design Geo Experiment",
    description:
      "Design a geographic holdout experiment with matched-pair region assignment for true incrementality measurement. Returns balanced treatment/holdout groups.",
    parametersSchema: {
      type: "object",
      required: ["name", "hypothesis", "availableRegions", "testDays", "treatmentBudgetPerDay"],
      properties: {
        name: { type: "string", description: "Experiment name" },
        hypothesis: { type: "string", description: "What you expect to prove" },
        availableRegions: {
          type: "array",
          description: "Regions available for the experiment (min 2)",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              type: { type: "string", enum: ["dma", "state", "country", "custom"] },
              population: { type: "number" },
              historicalSpend: { type: "number" },
              historicalConversions: { type: "number" },
            },
          },
        },
        primaryMetric: {
          type: "string",
          enum: ["conversions", "revenue", "store_visits"],
          description: "Primary metric to measure incrementality (default: conversions)",
        },
        testDays: { type: "number", description: "Duration of the test period in days" },
        preTestDays: {
          type: "number",
          description: "Baseline measurement period in days (default: 14)",
        },
        cooldownDays: {
          type: "number",
          description: "Post-test observation period in days (default: 7)",
        },
        treatmentBudgetPerDay: {
          type: "number",
          description: "Daily budget for treatment regions",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.geo_experiment.analyze",
    name: "Analyze Geo Experiment",
    description:
      "Analyze a completed geo-holdout experiment using difference-in-differences. Computes incremental lift, statistical significance, incremental CPA, and incremental ROAS.",
    parametersSchema: {
      type: "object",
      required: ["experimentId", "regionMetrics"],
      properties: {
        experimentId: { type: "string", description: "Geo experiment ID to analyze" },
        regionMetrics: {
          type: "array",
          description: "Per-region metrics for pre-test, test, and post-test periods",
          items: {
            type: "object",
            required: [
              "regionId",
              "preTestConversions",
              "preTestRevenue",
              "testConversions",
              "testRevenue",
            ],
            properties: {
              regionId: { type: "string" },
              preTestConversions: { type: "number" },
              preTestRevenue: { type: "number" },
              testConversions: { type: "number" },
              testRevenue: { type: "number" },
              postTestConversions: { type: "number" },
              postTestRevenue: { type: "number" },
            },
          },
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.geo_experiment.power",
    name: "Geo Experiment Power Analysis",
    description:
      "Calculate minimum test duration for a geo-holdout experiment using difference-in-differences power analysis. Accounts for between-region variance.",
    parametersSchema: {
      type: "object",
      required: ["baselineConversionRatePerRegion", "minimumDetectableLift", "numberOfRegions"],
      properties: {
        baselineConversionRatePerRegion: {
          type: "number",
          description: "Average daily conversions per region at baseline",
        },
        minimumDetectableLift: {
          type: "number",
          description: "Minimum relative lift to detect (e.g. 0.05 for 5%)",
        },
        numberOfRegions: {
          type: "number",
          description: "Total number of regions available (split between treatment and holdout)",
        },
        significanceLevel: {
          type: "number",
          description: "Statistical significance level (default: 0.05)",
        },
        power: {
          type: "number",
          description: "Statistical power (default: 0.80)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.geo_experiment.create",
    name: "Create Geo Experiment",
    description:
      "Create and start a geographic holdout experiment. Designs matched-pair region assignment and transitions to running state.",
    parametersSchema: {
      type: "object",
      required: ["name", "hypothesis", "availableRegions", "testDays", "treatmentBudgetPerDay"],
      properties: {
        name: { type: "string", description: "Experiment name" },
        hypothesis: { type: "string", description: "What you expect to prove" },
        availableRegions: {
          type: "array",
          description: "Regions available for the experiment (min 2)",
        },
        primaryMetric: {
          type: "string",
          enum: ["conversions", "revenue", "store_visits"],
          description: "Primary metric (default: conversions)",
        },
        testDays: { type: "number", description: "Test period duration in days" },
        preTestDays: { type: "number", description: "Baseline period in days (default: 14)" },
        cooldownDays: { type: "number", description: "Post-test period in days (default: 7)" },
        treatmentBudgetPerDay: {
          type: "number",
          description: "Daily budget for treatment regions",
        },
      },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "digital-ads.geo_experiment.conclude",
    name: "Conclude Geo Experiment",
    description: "Mark a running geo-holdout experiment as concluded.",
    parametersSchema: {
      type: "object",
      required: ["experimentId"],
      properties: {
        experimentId: { type: "string", description: "Geo experiment ID to conclude" },
      },
    },
    baseRiskCategory: "medium",
    reversible: false,
  },
  {
    actionType: "digital-ads.kpi.list",
    name: "List Custom KPIs",
    description:
      "List all registered custom KPI definitions and available preset KPI templates. Returns both user-defined KPIs and built-in preset definitions (Blended CPA, ROAS, CPM Efficiency, etc.).",
    parametersSchema: {
      type: "object",
      properties: {},
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.kpi.compute",
    name: "Compute Custom KPIs",
    description:
      "Compute one or all registered custom KPIs against a provided metrics map. If kpiId is provided, computes only that KPI; otherwise computes all registered KPIs. Returns computed values with formatting, threshold status, and target percentage.",
    parametersSchema: {
      type: "object",
      required: ["metrics"],
      properties: {
        kpiId: {
          type: "string",
          description:
            "Optional KPI ID to compute a single KPI. If omitted, all registered KPIs are computed.",
        },
        metrics: {
          type: "object",
          description:
            "Map of metric names to numeric values (e.g. { spend: 1000, conversions: 50, revenue: 5000 })",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.kpi.register",
    name: "Register Custom KPI",
    description:
      "Define and register a new custom KPI with a formula type (sum, average, weighted_average, ratio, or custom expression), formatting, and optional threshold alerts. Custom expressions support arithmetic operators (+, -, *, /) with metric names as variables.",
    parametersSchema: {
      type: "object",
      required: ["name", "description", "type", "format", "higherIsBetter"],
      properties: {
        name: { type: "string", description: "Human-readable KPI name" },
        description: { type: "string", description: "What this KPI measures" },
        type: {
          type: "string",
          enum: ["sum", "average", "weighted_average", "ratio", "custom"],
          description: "Formula type for computing this KPI",
        },
        numerator: { type: "string", description: "For ratio type: numerator metric key" },
        denominator: { type: "string", description: "For ratio type: denominator metric key" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "For sum/average/weighted_average: list of metric keys to aggregate",
        },
        weightMetric: { type: "string", description: "For weighted_average: weight metric key" },
        expression: {
          type: "string",
          description:
            "For custom type: arithmetic expression using metric names as variables (e.g. 'revenue / spend', '(clicks + video_views) / impressions')",
        },
        format: {
          type: "string",
          enum: ["number", "currency", "percentage", "multiplier"],
          description: "How to format the computed value",
        },
        higherIsBetter: {
          type: "boolean",
          description:
            "Whether higher values are better (used for threshold evaluation and ranking)",
        },
        target: { type: "number", description: "Optional target value for threshold alerts" },
        warningThreshold: { type: "number", description: "Value that triggers a warning status" },
        criticalThreshold: {
          type: "number",
          description: "Value that triggers a critical status",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.kpi.remove",
    name: "Remove Custom KPI",
    description: "Remove a previously registered custom KPI definition by its ID.",
    parametersSchema: {
      type: "object",
      required: ["kpiId"],
      properties: {
        kpiId: { type: "string", description: "The ID of the KPI to remove" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.seasonal.calendar",
    name: "Seasonal Calendar",
    description:
      "Get a 12-month seasonal calendar for a given vertical and region. Returns events, CPM multipliers, competition levels, and budget recommendations per month. Use this for annual planning and budget allocation.",
    parametersSchema: {
      type: "object",
      required: ["vertical"],
      properties: {
        vertical: {
          type: "string",
          enum: ["commerce", "leadgen", "brand"],
          description: "Business vertical for seasonal analysis",
        },
        region: {
          type: "string",
          enum: ["global", "us", "uk", "eu", "apac", "latam", "mena"],
          description: "Region for region-specific events (default: global)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.seasonal.events",
    name: "Seasonal Events",
    description:
      "Query seasonal events filtered by region, vertical, month, and/or category. Returns matching events sorted by CPM impact (highest first) with recommendations.",
    parametersSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          enum: ["global", "us", "uk", "eu", "apac", "latam", "mena"],
          description: "Filter by region",
        },
        vertical: {
          type: "string",
          enum: ["commerce", "leadgen", "brand"],
          description: "Filter by business vertical",
        },
        month: {
          type: "number",
          description: "Filter by month (1-12)",
        },
        category: {
          type: "string",
          enum: ["retail", "cultural", "sports", "industry", "platform"],
          description: "Filter by event category",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.seasonal.add_event",
    name: "Add Custom Seasonal Event",
    description:
      "Register a custom seasonal event to the calendar. Custom events are merged with built-in events for all seasonal queries. Use this for industry-specific or client-specific events not in the default calendar.",
    parametersSchema: {
      type: "object",
      required: [
        "name",
        "startMMDD",
        "endMMDD",
        "cpmThresholdMultiplier",
        "cpaThresholdMultiplier",
        "category",
        "region",
        "verticals",
      ],
      properties: {
        name: { type: "string", description: "Human-readable event name" },
        startMMDD: { type: "string", description: "Start date in MM-DD format (inclusive)" },
        endMMDD: { type: "string", description: "End date in MM-DD format (inclusive)" },
        cpmThresholdMultiplier: {
          type: "number",
          description: "CPM threshold multiplier (e.g. 1.2 = 20% increase expected)",
        },
        cpaThresholdMultiplier: { type: "number", description: "CPA threshold multiplier" },
        category: {
          type: "string",
          enum: ["retail", "cultural", "sports", "industry", "platform"],
          description: "Event category",
        },
        region: {
          type: "string",
          enum: ["global", "us", "uk", "eu", "apac", "latam", "mena"],
          description: "Event region",
        },
        verticals: {
          type: "array",
          description: "Applicable verticals (commerce, leadgen, brand, all)",
        },
        impact: {
          type: "string",
          description: "Description of the event's impact on ad performance",
        },
        recommendedActions: {
          type: "array",
          description: "List of recommended actions during this event",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.ltv.project",
    name: "Project Customer LTV",
    description:
      "Project lifetime value for a customer cohort by fitting a curve (log, power, or linear) to revenue-over-time data. Returns projected 90-day and 365-day LTV, LTV:CAC ratio, payback period, confidence level, and curve parameters.",
    parametersSchema: {
      type: "object",
      required: ["cohort"],
      properties: {
        cohort: {
          type: "object",
          description:
            "Customer cohort data including acquisition cost, revenue timeline (day0 through day365), retention rates, and purchase metrics",
          required: [
            "cohortId",
            "acquisitionDate",
            "customerCount",
            "totalAcquisitionCost",
            "costPerAcquisition",
            "revenue",
            "retention",
            "avgOrderCount",
            "avgOrderValue",
          ],
          properties: {
            cohortId: { type: "string", description: "Unique cohort identifier" },
            acquisitionCampaignId: {
              type: "string",
              description: "Acquisition source campaign ID",
            },
            acquisitionAdSetId: { type: "string", description: "Acquisition source ad set ID" },
            acquisitionDate: {
              type: "string",
              description: "Cohort acquisition date (YYYY-MM-DD)",
            },
            customerCount: { type: "number", description: "Number of customers in the cohort" },
            totalAcquisitionCost: {
              type: "number",
              description: "Total acquisition cost for the cohort",
            },
            costPerAcquisition: { type: "number", description: "Cost per acquisition (CPA)" },
            revenue: {
              type: "object",
              description: "Cumulative revenue at each time point",
              properties: {
                day0: { type: "number" },
                day7: { type: "number" },
                day14: { type: "number" },
                day30: { type: "number" },
                day60: { type: "number" },
                day90: { type: "number" },
                day180: { type: "number" },
                day365: { type: "number" },
              },
            },
            retention: {
              type: "object",
              description: "Retention rates at each time point (0-1)",
              properties: {
                day7: { type: "number" },
                day14: { type: "number" },
                day30: { type: "number" },
                day60: { type: "number" },
                day90: { type: "number" },
              },
            },
            avgOrderCount: {
              type: "number",
              description: "Average number of orders per customer",
            },
            avgOrderValue: { type: "number", description: "Average order value" },
            segment: { type: "string", description: "Optional segment label for grouping" },
          },
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.ltv.optimize",
    name: "Optimize by Cohort LTV",
    description:
      "Analyze multiple customer cohorts and generate campaign-level LTV optimization recommendations. Projects LTV for each cohort, computes LTV:CAC ratios, and recommends scaling, maintaining, reducing, or pausing each campaign. Includes segment-level insights and LTV distribution.",
    parametersSchema: {
      type: "object",
      required: ["cohorts"],
      properties: {
        cohorts: {
          type: "array",
          description: "Array of customer cohort data objects",
          items: {
            type: "object",
            description:
              "CustomerCohort object with acquisition cost, revenue timeline, retention rates, and purchase metrics",
          },
        },
        targetLTVtoCACRatio: {
          type: "number",
          description:
            "Target LTV:CAC ratio benchmark (default: 3.0). Campaigns above this are healthy; below need attention.",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.ltv.allocate",
    name: "Allocate Budget by LTV",
    description:
      "Allocate campaign budgets proportionally to their LTV:CAC ratio. Maps campaigns to customer cohorts, projects LTV per campaign, and redistributes budget toward higher-LTV campaigns. Changes are capped at 30% per campaign with a $5 minimum budget.",
    parametersSchema: {
      type: "object",
      required: ["campaigns", "cohorts"],
      properties: {
        campaigns: {
          type: "array",
          description: "Campaign data with current budget and CPA",
          items: {
            type: "object",
            required: ["campaignId", "campaignName", "dailyBudget", "cpa"],
            properties: {
              campaignId: {
                type: "string",
                description: "Campaign ID (must match cohort acquisitionCampaignId)",
              },
              campaignName: { type: "string", description: "Campaign name" },
              dailyBudget: { type: "number", description: "Current daily budget" },
              cpa: { type: "number", description: "Current cost per acquisition" },
            },
          },
        },
        cohorts: {
          type: "array",
          description: "Customer cohort data (linked to campaigns via acquisitionCampaignId)",
          items: {
            type: "object",
            description: "CustomerCohort object",
          },
        },
        totalBudget: {
          type: "number",
          description:
            "Optional total budget constraint. If omitted, uses sum of current campaign budgets.",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
];
