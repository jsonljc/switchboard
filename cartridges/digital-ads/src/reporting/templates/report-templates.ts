// ---------------------------------------------------------------------------
// Report Templates — Standard report configurations
// ---------------------------------------------------------------------------

import type { ReportBreakdown, ReportLevel } from "../types.js";

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  level: ReportLevel;
  breakdowns: ReportBreakdown[];
  fields: string[];
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "overview",
    name: "Account Overview",
    description: "High-level account performance summary",
    level: "account",
    breakdowns: [],
    fields: [
      "spend",
      "impressions",
      "clicks",
      "actions",
      "ctr",
      "cpm",
      "cpc",
      "reach",
      "frequency",
    ],
  },
  {
    id: "campaign_performance",
    name: "Campaign Performance",
    description: "Performance breakdown by campaign",
    level: "campaign",
    breakdowns: [],
    fields: [
      "spend",
      "impressions",
      "clicks",
      "actions",
      "ctr",
      "cpm",
      "cpc",
      "cost_per_action_type",
    ],
  },
  {
    id: "demographic",
    name: "Demographic Breakdown",
    description: "Performance by age and gender",
    level: "account",
    breakdowns: ["age", "gender"],
    fields: ["spend", "impressions", "clicks", "actions", "ctr"],
  },
  {
    id: "geo",
    name: "Geographic Breakdown",
    description: "Performance by country",
    level: "account",
    breakdowns: ["country"],
    fields: ["spend", "impressions", "clicks", "actions", "ctr"],
  },
  {
    id: "placement",
    name: "Placement Breakdown",
    description: "Performance by platform and position",
    level: "account",
    breakdowns: ["publisher_platform", "platform_position"],
    fields: ["spend", "impressions", "clicks", "actions", "ctr", "cpm"],
  },
  {
    id: "device",
    name: "Device Breakdown",
    description: "Performance by device type",
    level: "account",
    breakdowns: ["impression_device"],
    fields: ["spend", "impressions", "clicks", "actions", "ctr", "cpm"],
  },
];

export function getReportTemplate(id: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.id === id);
}
