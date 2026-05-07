// apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts
import type { AgentKey } from "@switchboard/schemas";
import type {
  GreetingViewModel,
  MetricsViewModel,
  PipelineViewModel,
} from "@/lib/agent-home/types";

const NOW_ISO = "2026-05-04T08:00:00.000Z";

const greetings: Record<"alex" | "riley", GreetingViewModel> = {
  alex: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Three leads are waiting on you. " },
      { kind: "accent", text: "Maya" },
      { kind: "text", text: " is the one I'd answer first — she's been ready for " },
      { kind: "accent", text: "two days" },
      { kind: "text", text: "." },
    ],
    signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
  riley: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Two ad sets need your eye. " },
      { kind: "accent", text: "Whitening" },
      { kind: "text", text: " is bleeding budget faster than the others — start there." },
    ],
    signal: { inboxCount: 2, oldestOpenItemAgeHours: 6, hoursSinceLastOperatorAction: 18 },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
};

const metrics: Record<"alex" | "riley", MetricsViewModel> = {
  alex: {
    hero: { kind: "tours-booked", value: 14, comparator: { window: "week", value: 9 } },
    heroSubProseSegments: [
      {
        kind: "text",
        text: "Up from 9 last week. Maya, Jordan, and Priya are most likely to convert.",
      },
    ],
    spark: [
      { label: "4 wks ago", value: 7 },
      { label: "3 wks ago", value: 8 },
      { label: "2 wks ago", value: 9 },
      { label: "last week", value: 9 },
      { label: "Mon", value: 2 },
      { label: "Tue", value: 5 },
      { label: "Wed", value: 8 },
      { label: "Thu", value: 11 },
      { label: "Fri", value: 14, isProjection: true },
    ],
    stats: [
      { label: "Leads", display: "47", rawValue: 47, unit: "count" },
      { label: "Conversion", display: "26%", rawValue: 0.26, unit: "percent" },
      { label: "Spend", display: "$0", rawValue: 0, unit: "currency" },
    ],
    freshness: { generatedAt: NOW_ISO, window: "week", dataSource: "fixture" },
    folioRange: "Mon — Fri",
  },
  riley: {
    hero: { kind: "ad-leads", value: 86, comparator: { window: "week", value: 71 } },
    heroSubProseSegments: [
      { kind: "text", text: "+15 from last week. Whitening A is doing the heavy lifting." },
    ],
    spark: [
      { label: "4 wks ago", value: 52 },
      { label: "3 wks ago", value: 64 },
      { label: "2 wks ago", value: 71 },
      { label: "last week", value: 71 },
      { label: "Mon", value: 12 },
      { label: "Tue", value: 18 },
      { label: "Wed", value: 22 },
      { label: "Thu", value: 17 },
      { label: "Fri", value: 17, isProjection: true },
    ],
    stats: [
      { label: "Leads", display: "86", rawValue: 86, unit: "count" },
      { label: "CTR", display: "3.4%", rawValue: 0.034, unit: "percent" },
      { label: "Spend", display: "$1,420", rawValue: 1420, unit: "currency" },
    ],
    freshness: { generatedAt: NOW_ISO, window: "week", dataSource: "fixture" },
    folioRange: "Mon — Fri",
  },
};

const pipeline: Record<"alex" | "riley", PipelineViewModel> = {
  alex: {
    agentKey: "alex",
    pipelineKind: "leads",
    totalCount: 7,
    countNoun: "people",
    tiles: [
      {
        id: "c1",
        stage: "hot",
        name: "Maya R.",
        ctx: "Asked about Saturday classes. Two days ready.",
        link: { kind: "contact", id: "c1" },
      },
      {
        id: "c2",
        stage: "warm",
        name: "Jordan F.",
        ctx: "Wants 6-month pricing. Saturday tour booked.",
        link: { kind: "contact", id: "c2" },
      },
      {
        id: "c3",
        stage: "warm",
        name: "Priya M.",
        ctx: "Injury question, escalated to you.",
        link: { kind: "contact", id: "c3" },
      },
      {
        id: "c4",
        stage: "new",
        name: "Tom W.",
        ctx: "Cold — refund request saved with guest passes.",
        link: { kind: "contact", id: "c4" },
      },
      {
        id: "c5",
        stage: "new",
        name: "Avi R.",
        ctx: "14-day-cold lead, just re-engaged.",
        link: { kind: "contact", id: "c5" },
      },
    ],
    setupLink: { kind: "agent-setup", agentKey: "alex" },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
  riley: {
    agentKey: "riley",
    pipelineKind: "ad-sets",
    totalCount: 4,
    countNoun: "ad sets",
    tiles: [
      {
        id: "as-1",
        stage: "hot",
        name: "Whitening A",
        ctx: "CPL stable, scaling up budget today.",
        link: { kind: "ad-set", id: "as-1" },
      },
      {
        id: "as-2",
        stage: "warm",
        name: "Cleaning Combo",
        ctx: "Frequency creeping; rotate creatives.",
        link: { kind: "ad-set", id: "as-2" },
      },
      {
        id: "as-3",
        stage: "new",
        name: "Aligners (Test)",
        ctx: "Just launched. Watching first 48h.",
        link: { kind: "ad-set", id: "as-3" },
      },
    ],
    setupLink: { kind: "agent-setup", agentKey: "riley" },
    freshness: { generatedAt: NOW_ISO, window: "today", dataSource: "fixture" },
  },
};

export function getFixtureGreeting(agentKey: AgentKey): GreetingViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return greetings[agentKey];
}

export function getFixtureMetrics(agentKey: AgentKey): MetricsViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return metrics[agentKey];
}

export function getFixturePipeline(agentKey: AgentKey): PipelineViewModel {
  if (agentKey === "mira") throw new Error("mira is not enabled in slice B");
  return pipeline[agentKey];
}
