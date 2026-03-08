// Pacing, alerting, and forecasting action definitions

import type { ActionDefinition } from "@switchboard/schemas";

export const pacingAlertingForecastingActions: readonly ActionDefinition[] = [
  {
    actionType: "digital-ads.pacing.check",
    name: "Check Pacing",
    description:
      "Check pacing status for a flight plan — compares actual vs planned spend based on pacing curve.",
    parametersSchema: {
      type: "object",
      required: ["flightId"],
      properties: {
        flightId: { type: "string", description: "Flight plan ID to check" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.pacing.create_flight",
    name: "Create Flight Plan",
    description: "Create a flight plan with budget, dates, and pacing curve for a campaign.",
    parametersSchema: {
      type: "object",
      required: ["name", "campaignId", "startDate", "endDate", "totalBudget"],
      properties: {
        name: { type: "string", description: "Flight plan name" },
        campaignId: { type: "string", description: "Campaign ID" },
        startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
        endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
        totalBudget: { type: "number", description: "Total flight budget in dollars" },
        pacingCurve: {
          type: "string",
          enum: ["even", "front-loaded", "back-loaded"],
          description: "Pacing curve (default: even)",
        },
      },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "digital-ads.pacing.auto_adjust",
    name: "Auto-Adjust Pacing",
    description: "Automatically adjust daily budget to correct pacing based on flight plan.",
    parametersSchema: {
      type: "object",
      required: ["flightId"],
      properties: {
        flightId: { type: "string", description: "Flight plan ID to adjust" },
      },
    },
    baseRiskCategory: "high",
    reversible: true,
  },
  {
    actionType: "digital-ads.alert.anomaly_scan",
    name: "Anomaly Scan",
    description: "Scan daily metrics for statistical anomalies using z-score and IQR methods.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId"],
      properties: {
        adAccountId: { type: "string", description: "Ad account ID" },
        datePreset: {
          type: "string",
          description: "Date preset for historical data (default: last_30d)",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.alert.budget_forecast",
    name: "Budget Forecast",
    description: "Forecast budget exhaustion timelines for all campaigns in an ad account.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId"],
      properties: {
        adAccountId: { type: "string", description: "Ad account ID" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.alert.policy_scan",
    name: "Policy Scan",
    description: "Scan for disapproved ads, policy violations, and approaching spend limits.",
    parametersSchema: {
      type: "object",
      required: ["adAccountId"],
      properties: {
        adAccountId: { type: "string", description: "Ad account ID" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.forecast.budget_scenario",
    name: "Budget Scenario",
    description:
      "Model budget scenarios using diminishing returns to project CPA at different spend levels.",
    parametersSchema: {
      type: "object",
      required: ["currentSpend", "currentConversions", "currentCPA", "scenarioBudgets"],
      properties: {
        currentSpend: { type: "number", description: "Current daily/period spend" },
        currentConversions: { type: "number", description: "Current conversions" },
        currentCPA: { type: "number", description: "Current CPA" },
        scenarioBudgets: {
          type: "array",
          items: { type: "number" },
          description: "Array of budget levels to model",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.forecast.diminishing_returns",
    name: "Diminishing Returns Analysis",
    description: "Analyze spend vs conversions data to find optimal spend point and saturation.",
    parametersSchema: {
      type: "object",
      required: ["dataPoints"],
      properties: {
        dataPoints: {
          type: "array",
          items: {
            type: "object",
            required: ["spend", "conversions"],
            properties: {
              spend: { type: "number" },
              conversions: { type: "number" },
            },
          },
          description: "Array of {spend, conversions} data points",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.plan.annual",
    name: "Annual Plan",
    description:
      "Create a 12-month annual plan with quarterly roll-ups, seasonal budget distribution, monthly CPA projections, strategic themes, and risk assessment.",
    parametersSchema: {
      type: "object",
      required: [
        "totalAnnualBudget",
        "vertical",
        "businessGoal",
        "currentMonthlyCPA",
        "currentMonthlyConversions",
        "currentMonthlySpend",
      ],
      properties: {
        totalAnnualBudget: { type: "number", description: "Total annual budget in dollars" },
        vertical: {
          type: "string",
          enum: ["commerce", "leadgen", "brand"],
          description: "Business vertical",
        },
        businessGoal: { type: "string", description: "High-level business goal" },
        currentMonthlyCPA: { type: "number", description: "Current monthly CPA" },
        currentMonthlyConversions: {
          type: "number",
          description: "Current monthly conversions",
        },
        currentMonthlySpend: { type: "number", description: "Current monthly spend" },
        currentROAS: { type: "number", description: "Current ROAS (optional)" },
        targetAnnualGrowth: {
          type: "number",
          description: "Target annual growth rate, e.g. 0.20 for 20%",
        },
        targetCPA: { type: "number", description: "Target CPA" },
        historicalMonthlyData: {
          type: "array",
          items: {
            type: "object",
            properties: {
              month: { type: "number" },
              spend: { type: "number" },
              conversions: { type: "number" },
              revenue: { type: "number" },
            },
          },
          description: "Historical monthly data for custom seasonality weights",
        },
        frontLoadBudget: {
          type: "boolean",
          description: "Whether to front-load budget in H1",
        },
        aggressiveScaling: {
          type: "boolean",
          description: "Whether to take more risk for growth",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.plan.quarterly",
    name: "Quarterly Plan",
    description:
      "Get a detailed plan for a single quarter, including monthly budgets, CPA projections, strategic theme, and key milestones.",
    parametersSchema: {
      type: "object",
      required: [
        "quarter",
        "totalAnnualBudget",
        "vertical",
        "businessGoal",
        "currentMonthlyCPA",
        "currentMonthlyConversions",
        "currentMonthlySpend",
      ],
      properties: {
        quarter: {
          type: "string",
          enum: ["Q1", "Q2", "Q3", "Q4"],
          description: "Which quarter to return",
        },
        totalAnnualBudget: { type: "number", description: "Total annual budget in dollars" },
        vertical: {
          type: "string",
          enum: ["commerce", "leadgen", "brand"],
          description: "Business vertical",
        },
        businessGoal: { type: "string", description: "High-level business goal" },
        currentMonthlyCPA: { type: "number", description: "Current monthly CPA" },
        currentMonthlyConversions: {
          type: "number",
          description: "Current monthly conversions",
        },
        currentMonthlySpend: { type: "number", description: "Current monthly spend" },
        currentROAS: { type: "number", description: "Current ROAS (optional)" },
        targetAnnualGrowth: {
          type: "number",
          description: "Target annual growth rate, e.g. 0.20 for 20%",
        },
        targetCPA: { type: "number", description: "Target CPA" },
        historicalMonthlyData: {
          type: "array",
          items: {
            type: "object",
            properties: {
              month: { type: "number" },
              spend: { type: "number" },
              conversions: { type: "number" },
              revenue: { type: "number" },
            },
          },
          description: "Historical monthly data for custom seasonality weights",
        },
        frontLoadBudget: {
          type: "boolean",
          description: "Whether to front-load budget in H1",
        },
        aggressiveScaling: {
          type: "boolean",
          description: "Whether to take more risk for growth",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.catalog.health",
    name: "Catalog Health Check",
    description: "Check product catalog health — review statuses, error rates, and diagnostics.",
    parametersSchema: {
      type: "object",
      required: ["catalogId"],
      properties: {
        catalogId: { type: "string", description: "Product catalog ID" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.catalog.product_sets",
    name: "Manage Product Sets",
    description: "List or create product sets within a catalog for dynamic ads.",
    parametersSchema: {
      type: "object",
      required: ["catalogId"],
      properties: {
        catalogId: { type: "string", description: "Product catalog ID" },
        action: {
          type: "string",
          enum: ["list", "create"],
          description: "Operation to perform (default: list)",
        },
        name: { type: "string", description: "Product set name (required for create)" },
        filter: { type: "object", description: "Product set filter rules (required for create)" },
      },
    },
    baseRiskCategory: "medium",
    reversible: true,
  },
  {
    actionType: "digital-ads.alert.configure_notifications",
    name: "Configure Notification Channels",
    description:
      "Set up notification channels (webhook, Slack, email) for automated alert delivery.",
    parametersSchema: {
      type: "object",
      required: ["channels"],
      properties: {
        channels: {
          type: "array",
          items: {
            type: "object",
            required: ["type"],
            properties: {
              type: {
                type: "string",
                enum: ["webhook", "slack", "email"],
                description: "Channel type",
              },
              url: { type: "string", description: "Webhook URL (for webhook type)" },
              webhookUrl: {
                type: "string",
                description: "Slack incoming webhook URL (for slack type)",
              },
              channel: { type: "string", description: "Slack channel override" },
              smtpHost: { type: "string", description: "SMTP host (for email type)" },
              smtpPort: { type: "number", description: "SMTP port (for email type)" },
              from: { type: "string", description: "Sender email (for email type)" },
              to: {
                type: "array",
                items: { type: "string" },
                description: "Recipient emails (for email type)",
              },
            },
          },
          description: "Array of notification channel configurations",
        },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
  {
    actionType: "digital-ads.alert.send_notifications",
    name: "Send Alert Notifications",
    description:
      "Dispatch alert notifications to all configured channels. Accepts anomaly, budget, or policy alert data.",
    parametersSchema: {
      type: "object",
      required: ["accountId"],
      properties: {
        accountId: { type: "string", description: "Ad account ID" },
        alertType: {
          type: "string",
          enum: ["anomaly", "budget_forecast", "policy_violation"],
          description: "Filter to specific alert type",
        },
        anomalies: { type: "array", description: "Anomaly results to dispatch" },
        forecasts: { type: "array", description: "Budget forecast results to dispatch" },
        scanResult: { type: "object", description: "Policy scan result to dispatch" },
      },
    },
    baseRiskCategory: "low",
    reversible: true,
  },
];
