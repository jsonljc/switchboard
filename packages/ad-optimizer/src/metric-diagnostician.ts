// packages/core/src/ad-optimizer/metric-diagnostician.ts
import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";

// ── Types ──

export interface Diagnosis {
  pattern: string;
  description: string;
  confidence: "high" | "medium" | "low";
}

// ── Constants ──

const COST_METRICS = new Set(["cpm", "cpc", "cpl", "cpa"]);
const PERFORMANCE_METRICS = new Set(["ctr", "roas"]);

// ── Helpers ──

function isDegradingSignificantly(delta: MetricDelta): boolean {
  if (!delta.significant) return false;
  if (COST_METRICS.has(delta.metric)) return delta.direction === "up";
  if (PERFORMANCE_METRICS.has(delta.metric)) return delta.direction === "down";
  return false;
}

// ── Rules ──

interface Rule {
  pattern: string;
  description: string;
  confidence: "high" | "medium" | "low";
  match: (map: Map<string, MetricDelta>) => boolean;
}

const RULES: Rule[] = [
  {
    pattern: "creative_fatigue",
    description: "Creative fatigue — high frequency with declining engagement",
    confidence: "high",
    match: (map) => {
      const ctr = map.get("ctr");
      const freq = map.get("frequency");
      const cpa = map.get("cpa");
      const cpm = map.get("cpm");
      const ctrDownSignificant = ctr !== undefined && ctr.direction === "down" && ctr.significant;
      const freqRising = freq !== undefined && freq.direction === "up" && freq.significant;
      const cpmNotSignificant = cpm === undefined || !cpm.significant;
      const cpaRisingOrStable =
        cpa === undefined || cpa.direction === "up" || cpa.direction === "stable";
      return ctrDownSignificant && freqRising && cpmNotSignificant && cpaRisingOrStable;
    },
  },
  {
    pattern: "competition_increase",
    description: "Competition or seasonal demand increase",
    confidence: "medium",
    match: (map) => {
      const cpm = map.get("cpm");
      const ctr = map.get("ctr");
      const cpmUpSignificant = cpm !== undefined && cpm.direction === "up" && cpm.significant;
      const ctrStableOrMissing = ctr === undefined || ctr.direction === "stable";
      return cpmUpSignificant && ctrStableOrMissing;
    },
  },
  {
    pattern: "landing_page_drop",
    description: "Landing page conversion drop",
    confidence: "high",
    match: (map) => {
      const cpl = map.get("cpl");
      const ctr = map.get("ctr");
      const cplUpSignificant = cpl !== undefined && cpl.direction === "up" && cpl.significant;
      const ctrNotSignificant = ctr === undefined || !ctr.significant;
      return cplUpSignificant && ctrNotSignificant;
    },
  },
  {
    pattern: "lead_quality_issue",
    description: "Lead quality dropping",
    confidence: "medium",
    match: (map) => {
      const cpa = map.get("cpa");
      const cpl = map.get("cpl");
      const cpaUpSignificant = cpa !== undefined && cpa.direction === "up" && cpa.significant;
      const cplNotSignificant = cpl === undefined || !cpl.significant;
      return cpaUpSignificant && cplNotSignificant;
    },
  },
  {
    pattern: "audience_saturation",
    description: "Audience saturation — need fresh audience or creative",
    confidence: "high",
    match: (map) => {
      const freq = map.get("frequency");
      const ctr = map.get("ctr");
      const freqRising = freq !== undefined && freq.direction === "up" && freq.significant;
      const ctrDownSignificant = ctr !== undefined && ctr.direction === "down" && ctr.significant;
      return freqRising && ctrDownSignificant;
    },
  },
  {
    pattern: "audience_offer_mismatch",
    description: "Strong clicks but low conversions",
    confidence: "high",
    match: (map) => {
      const ctr = map.get("ctr");
      const cpa = map.get("cpa");
      const ctrUpOrStable =
        ctr !== undefined && (ctr.direction === "up" || ctr.direction === "stable");
      const cpaUpSignificant = cpa !== undefined && cpa.direction === "up" && cpa.significant;
      return ctrUpOrStable && cpaUpSignificant;
    },
  },
  {
    pattern: "lead_quality_degradation",
    description: "CPL improving but downstream booking cost rising — leads are lower quality",
    confidence: "high",
    match: (map) => {
      const cpl = map.get("cpl");
      const cpb = map.get("costPerBooked");
      if (!cpl || !cpb) return false;
      const cplDown = cpl.current < cpl.previous;
      const cpbUp = cpb.previous > 0 && cpb.current > cpb.previous * 1.2;
      return cplDown && cpbUp;
    },
  },
  {
    pattern: "ctwa_drive_by_clickers",
    description: "Chat starts up but reply rate down — clicks are not converting to conversations",
    confidence: "high",
    match: (map) => {
      const chats = map.get("chatsStarted");
      const reply = map.get("replyRate");
      if (!chats || !reply) return false;
      const chatsUp = chats.previous > 0 && chats.current > chats.previous * 1.2;
      const replyDown = reply.previous > 0 && reply.current < reply.previous * 0.7;
      return chatsUp && replyDown;
    },
  },
  {
    pattern: "account_level_issue",
    description: "All metrics degrading",
    confidence: "low",
    match: (map) => {
      let degradingCount = 0;
      for (const delta of map.values()) {
        if (isDegradingSignificantly(delta)) degradingCount++;
      }
      return degradingCount >= 3;
    },
  },
];

// ── Main export ──

export function diagnose(deltas: MetricDelta[]): Diagnosis[] {
  const map = new Map<string, MetricDelta>();
  for (const delta of deltas) {
    map.set(delta.metric, delta);
  }

  const results: Diagnosis[] = [];
  for (const rule of RULES) {
    if (rule.match(map)) {
      results.push({
        pattern: rule.pattern,
        description: rule.description,
        confidence: rule.confidence,
      });
    }
  }
  return results;
}
