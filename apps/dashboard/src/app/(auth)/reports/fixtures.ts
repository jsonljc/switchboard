/**
 * /reports fixtures — three illustrative datasets ported from the
 * Claude Design bundle (`reports-design/.../reports-data.jsx`).
 *
 * Window mapping (matches the design's own mapping):
 *   THIS WEEK    → quietFixture
 *   THIS MONTH   → goodFixture (default)
 *   THIS QUARTER → problemFixture
 *
 * Types are imported from @switchboard/schemas; this file only owns the
 * sample data. Live attribution wiring lands in PR-R3 (period rollup).
 *
 * NOTE: `managedComparison` is null in fixtures; PR-R4 wires the live
 * comparison data.
 */

import {
  type ReportDataV1,
  type ReportWindow,
  REPORT_WINDOWS,
  DEFAULT_REPORT_WINDOW,
} from "@switchboard/schemas";

export type { ReportDataV1 as ReportData, ReportWindow } from "@switchboard/schemas";
export type {
  Delta,
  DeltaKind,
  PullQuoteCopy,
  AttributionCell,
  AttributionData,
  FunnelRowData,
  FunnelNarrative,
  CampaignStage,
  CampaignRow,
  CostBreakdown,
  ManagedComparisonData,
  ManagedComparisonPair,
  ManagedComparisonMetrics,
  ManagedComparisonSource,
} from "@switchboard/schemas";

export { REPORT_WINDOWS, DEFAULT_REPORT_WINDOW };

export const goodFixture: ReportDataV1 = {
  label: "THIS MONTH",
  period: "APR 1 — APR 30",
  dateFolio: "APR 1 — APR 30",
  pullquote: {
    pre: "Your team earned you ",
    value: "$14,700",
    mid: " in attributed pipeline value this month for ",
    cost: "$447.75",
    post: ". Riley caught two creative-fatigue events early; Alex booked Lisa K. when she nearly went cold.",
  },
  attribution: {
    total: 14700,
    delta: { kind: "pos", text: "Up 22% vs March" },
    riley: { value: 9200, caption: "ad-driven leads converted" },
    alex: { value: 5500, caption: "lead replies converted" },
  },
  funnel: [
    {
      stage: "Impressions",
      n: 342000,
      label: "342k",
      delta: { kind: "pos", text: "↑ 8% vs March" },
    },
    { stage: "Clicks", n: 4200, label: "4,200", delta: { kind: "pos", text: "↑ 3% vs March" } },
    { stage: "Landing visits", n: 3890, label: "3,890", delta: null },
    { stage: "Leads", n: 247, label: "247", delta: { kind: "pos", text: "↑ 14% vs March" } },
    { stage: "Bookings", n: 47, label: "47", delta: { kind: "pos", text: "↑ 9% vs March" } },
  ],
  funnelNarrative: {
    marker: "Riley · Apr 22",
    text: "CTR holding above category benchmark. Spring-Buyers is doing most of the lift; Q2-Lookalikes is dragging.",
  },
  campaigns: [
    { name: "Spring-Buyers", stage: "hot", spend: 620, leads: 14, revenue: 3200, roas: 5.2 },
    { name: "Q2-Lookalikes", stage: "cool", spend: 410, leads: 4, revenue: 480, roas: 1.2 },
    { name: "Retargeting-30d", stage: "hot", spend: 217, leads: 9, revenue: 1420, roas: 6.5 },
    { name: "Brand-Search", stage: "warm", spend: 168, leads: 7, revenue: 980, roas: 5.8 },
    { name: "Pinterest-Test", stage: "cool", spend: 95, leads: 2, revenue: 0, roas: 0.0 },
  ],
  cost: { paid: 447.75, alt: 8000, saving: 7552 },
  costNarrative:
    "You'd pay this much for a junior SDR (~$5,000/mo all-in) plus a small ad agency retainer (~$3,000/mo). Your team replaces both.",
  managedComparison: null,
};

export const quietFixture: ReportDataV1 = {
  label: "THIS WEEK",
  period: "APR 27 — MAY 3",
  dateFolio: "APR 27 — MAY 3",
  pullquote: {
    pre: "A quieter week — ",
    value: "$3,180",
    mid: " in attributed pipeline against ",
    cost: "$103.20",
    post: " paid. Most came from Spring-Buyers. We can talk about whether to scale or hold.",
  },
  attribution: {
    total: 3180,
    delta: { kind: "flat", text: "Roughly flat vs the week before" },
    riley: { value: 2100, caption: "ad-driven leads converted" },
    alex: { value: 1080, caption: "lead replies converted" },
  },
  funnel: [
    { stage: "Impressions", n: 78000, label: "78k", delta: null },
    { stage: "Clicks", n: 920, label: "920", delta: null },
    { stage: "Landing visits", n: 870, label: "870", delta: null },
    { stage: "Leads", n: 54, label: "54", delta: null },
    { stage: "Bookings", n: 9, label: "9", delta: null },
  ],
  funnelNarrative: {
    marker: "Riley · Apr 30",
    text: "Volume is light because we paused Pinterest-Test on Tuesday. CTR and conversion shape look healthy underneath.",
  },
  campaigns: [
    { name: "Spring-Buyers", stage: "hot", spend: 142, leads: 5, revenue: 980, roas: 6.9 },
    { name: "Retargeting-30d", stage: "hot", spend: 58, leads: 3, revenue: 410, roas: 7.1 },
    { name: "Brand-Search", stage: "warm", spend: 41, leads: 1, revenue: 180, roas: 4.4 },
  ],
  cost: { paid: 103.2, alt: 1846, saving: 1742 },
  costNarrative:
    "A quiet week is a fair test — even at low volume your team's base cost is a fraction of what an SDR plus retainer would run pro-rated.",
  managedComparison: null,
};

export const problemFixture: ReportDataV1 = {
  label: "THIS QUARTER",
  period: "FEB 1 — APR 30",
  dateFolio: "FEB 1 — APRIL 30",
  pullquote: {
    pre: "Mixed quarter — ",
    value: "$28,400",
    mid: " attributed against ",
    cost: "$1,343.25",
    post: ". February was strong, March slipped on creative fatigue. Riley flagged it on Mar 14; we recovered in April.",
  },
  attribution: {
    total: 28400,
    delta: { kind: "neg", text: "Down 6% vs Q1" },
    riley: { value: 18600, caption: "ad-driven leads converted" },
    alex: { value: 9800, caption: "lead replies converted" },
  },
  funnel: [
    {
      stage: "Impressions",
      n: 1020000,
      label: "1.02m",
      delta: { kind: "pos", text: "↑ 4% vs Q1" },
    },
    { stage: "Clicks", n: 11800, label: "11.8k", delta: { kind: "neg", text: "↓ 9% vs Q1" } },
    { stage: "Landing visits", n: 10940, label: "10.9k", delta: null },
    { stage: "Leads", n: 612, label: "612", delta: { kind: "neg", text: "↓ 12% vs Q1" } },
    { stage: "Bookings", n: 118, label: "118", delta: { kind: "neg", text: "↓ 8% vs Q1" } },
  ],
  funnelNarrative: {
    marker: "Riley · Mar 14",
    text: "Friction at clicks → leads. CTR holding but conversion dropped — likely creative fatigue on the March wave.",
  },
  campaigns: [
    { name: "Spring-Buyers", stage: "hot", spend: 1820, leads: 38, revenue: 8400, roas: 4.6 },
    { name: "Q2-Lookalikes", stage: "cool", spend: 1240, leads: 12, revenue: 1440, roas: 1.2 },
    { name: "Retargeting-30d", stage: "hot", spend: 651, leads: 27, revenue: 4260, roas: 6.5 },
    { name: "Brand-Search", stage: "warm", spend: 504, leads: 21, revenue: 2940, roas: 5.8 },
    { name: "Pinterest-Test", stage: "cool", spend: 285, leads: 4, revenue: 320, roas: 1.1 },
    { name: "TikTok-Pilot", stage: "cool", spend: 412, leads: 6, revenue: 480, roas: 1.2 },
  ],
  cost: { paid: 1343.25, alt: 24000, saving: 22657 },
  costNarrative:
    "Even in a soft quarter, you'd pay roughly $24,000 for an SDR plus retainer over three months. Your team came in at one-eighteenth the price.",
  managedComparison: null,
};

export const FIXTURES_BY_WINDOW: Record<ReportWindow, ReportDataV1> = {
  "THIS WEEK": quietFixture,
  "THIS MONTH": goodFixture,
  "THIS QUARTER": problemFixture,
};
