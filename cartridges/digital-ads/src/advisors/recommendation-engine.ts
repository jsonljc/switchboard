// ---------------------------------------------------------------------------
// Recommendation Engine — Advisor-to-Action Bridge
// ---------------------------------------------------------------------------
// Converts diagnostic findings into actionable proposals. Each proposal maps
// a high-severity finding to a concrete action that can be executed via the
// cartridge dispatcher.
// ---------------------------------------------------------------------------

import type { DiagnosticResult, Finding, Severity } from "../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionProposal {
  /** The finding that triggered this proposal */
  finding: Finding;
  /** The cartridge action type to execute */
  actionType: string;
  /** Parameters for the action */
  parameters: Record<string, unknown>;
  /** How confident the engine is in this recommendation (0-1) */
  confidence: number;
  /** Human-readable explanation of what this action will do */
  rationale: string;
  /** Expected impact description */
  expectedImpact: string;
  /** Risk level of the proposed action */
  riskLevel: "low" | "medium" | "high";
}

export interface RecommendationResult {
  /** All generated proposals, sorted by confidence descending */
  proposals: ActionProposal[];
  /** Findings that were analyzed but did not produce proposals */
  unactionable: Array<{ finding: Finding; reason: string }>;
  /** Summary statistics */
  summary: {
    totalFindings: number;
    actionableCount: number;
    unactionableCount: number;
    highestConfidence: number;
  };
}

// ---------------------------------------------------------------------------
// Finding pattern matchers
// ---------------------------------------------------------------------------

interface FindingMatcher {
  /** Test whether a finding matches this pattern */
  matches(finding: Finding): boolean;
  /** Generate an action proposal from the matched finding */
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null;
}

const CREATIVE_FATIGUE_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("creative fatigue") || msg.includes("creative exhaustion")) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    // For creative fatigue, recommend pausing underperforming ads
    // We can only recommend this at the campaign level since we don't have ad-level IDs here
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.funnel.diagnose",
      parameters: {
        platform: context.platform ?? "meta",
        entityId: context.entityId,
        vertical: context.vertical,
        enableHistoricalTrends: true,
      },
      confidence: finding.severity === "critical" ? 0.85 : 0.7,
      rationale:
        "Creative fatigue detected — CTR is declining while CPM remains stable or increasing. " +
        "A structural analysis with historical trends will identify which specific ads are underperforming.",
      expectedImpact: "Identify and isolate fatigued creatives to reduce wasted spend",
      riskLevel: "low",
    };
  },
};

const BUDGET_UNDERSPEND_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("underspend") ||
        msg.includes("under-spending") ||
        msg.includes("budget pacing") ||
        msg.includes("not fully spending")) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    // If spending significantly less than budget, suggest investigating
    const spendDelta =
      context.spend.previous > 0
        ? ((context.spend.current - context.spend.previous) / context.spend.previous) * 100
        : 0;

    return {
      finding,
      actionType: "digital-ads.structure.analyze",
      parameters: {
        platform: context.platform ?? "meta",
        entityId: context.entityId,
        vertical: context.vertical,
      },
      confidence: spendDelta < -20 ? 0.8 : 0.65,
      rationale:
        "Budget pacing issue detected — account is not spending its full budget. " +
        "Structural analysis will reveal whether bid caps, narrow targeting, or ad set fragmentation is limiting delivery.",
      expectedImpact: `Diagnose why spend dropped ${Math.abs(spendDelta).toFixed(1)}% and identify delivery bottlenecks`,
      riskLevel: "low",
    };
  },
};

const ADSET_FRAGMENTATION_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("fragmentation") || msg.includes("fragmented")) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.structure.analyze",
      parameters: {
        platform: context.platform ?? "meta",
        entityId: context.entityId,
        vertical: context.vertical,
      },
      confidence: finding.severity === "critical" ? 0.8 : 0.65,
      rationale:
        "Ad set fragmentation detected — too many ad sets are splitting budget and competing in the same auction. " +
        "Consolidating ad sets can improve delivery efficiency and reduce learning phase resets.",
      expectedImpact: "Identify ad sets to consolidate for better budget efficiency",
      riskLevel: "low",
    };
  },
};

const ROAS_EFFICIENCY_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("roas") || msg.includes("return on ad spend")) &&
      msg.includes("below") &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.funnel.diagnose",
      parameters: {
        platform: context.platform ?? "meta",
        entityId: context.entityId,
        vertical: context.vertical,
        enableStructuralAnalysis: true,
      },
      confidence: finding.severity === "critical" ? 0.75 : 0.6,
      rationale:
        "ROAS is below target — the account is spending more per conversion than expected. " +
        "A full funnel diagnosis with structural analysis will pinpoint where conversions are dropping off.",
      expectedImpact: "Identify conversion bottlenecks to improve return on ad spend",
      riskLevel: "low",
    };
  },
};

const AUDIENCE_SATURATION_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("audience saturation") || msg.includes("frequency") || msg.includes("reach")) &&
      msg.includes("high") &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.structure.analyze",
      parameters: {
        platform: context.platform ?? "meta",
        entityId: context.entityId,
        vertical: context.vertical,
      },
      confidence: finding.severity === "critical" ? 0.75 : 0.6,
      rationale:
        "Audience saturation detected — frequency is high and/or reach is plateauing. " +
        "Targeting expansion or audience refresh may be needed to maintain performance.",
      expectedImpact: "Identify opportunities to expand or refresh target audiences",
      riskLevel: "low",
    };
  },
};

const BID_STRATEGY_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("bid strategy") || msg.includes("bid cap")) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.structure.analyze",
      parameters: {
        platform: context.platform ?? "meta",
        entityId: context.entityId,
        vertical: context.vertical,
      },
      confidence: 0.6,
      rationale:
        "Bid strategy mismatch detected — the current bidding approach may be limiting delivery or increasing costs. " +
        "A structural analysis will evaluate whether the bid strategy aligns with campaign objectives.",
      expectedImpact: "Evaluate bid strategy alignment with campaign goals",
      riskLevel: "low",
    };
  },
};

const SIGNAL_QUALITY_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("signal") ||
        msg.includes("pixel") ||
        msg.includes("capi") ||
        msg.includes("conversion event")) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.signal.pixel.diagnose",
      parameters: { adAccountId: context.entityId },
      confidence: finding.severity === "critical" ? 0.9 : 0.7,
      rationale:
        "Signal quality issue detected — pixel or CAPI events may be missing or misconfigured. " +
        "A pixel diagnostic will identify which events are firing and which are missing.",
      expectedImpact: "Identify and fix tracking gaps to improve optimization signals",
      riskLevel: "low",
    };
  },
};

const LEARNING_PHASE_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("learning phase") || msg.includes("learning limited")) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.account.learning_phase",
      parameters: { adAccountId: context.entityId },
      confidence: 0.8,
      rationale:
        "Learning phase issues detected — ad sets may be stuck or in learning limited. " +
        "A learning phase check will identify which ad sets need attention.",
      expectedImpact: "Identify stuck ad sets and recommend consolidation or budget changes",
      riskLevel: "low",
    };
  },
};

const CREATIVE_ROTATION_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("creative") &&
        (msg.includes("rotation") || msg.includes("fatigue") || msg.includes("zero conversions"))) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.creative.analyze",
      parameters: { adAccountId: context.entityId },
      confidence: finding.severity === "critical" ? 0.85 : 0.7,
      rationale:
        "Creative performance issues detected — some ads may need to be paused or rotated. " +
        "A creative analysis will identify top/bottom performers and recommend rotation.",
      expectedImpact: "Identify and replace underperforming creatives to reduce wasted spend",
      riskLevel: "low",
    };
  },
};

const BUDGET_REALLOCATION_MATCHER: FindingMatcher = {
  matches(finding: Finding): boolean {
    const msg = finding.message.toLowerCase();
    return (
      (msg.includes("budget") &&
        (msg.includes("zero conversions") || msg.includes("over-funded") || msg.includes("under-funded"))) &&
      (finding.severity === "critical" || finding.severity === "warning")
    );
  },
  propose(finding: Finding, context: DiagnosticResult): ActionProposal | null {
    if (!context.entityId) return null;

    return {
      finding,
      actionType: "digital-ads.budget.recommend",
      parameters: { adAccountId: context.entityId },
      confidence: finding.severity === "critical" ? 0.8 : 0.65,
      rationale:
        "Budget allocation issue detected — some campaigns may be over or under-funded. " +
        "A budget recommendation will analyze cross-campaign efficiency and suggest reallocation.",
      expectedImpact: "Optimize budget distribution to maximize conversions per dollar",
      riskLevel: "low",
    };
  },
};

// ---------------------------------------------------------------------------
// Registry of all matchers
// ---------------------------------------------------------------------------

const MATCHERS: FindingMatcher[] = [
  CREATIVE_FATIGUE_MATCHER,
  BUDGET_UNDERSPEND_MATCHER,
  ADSET_FRAGMENTATION_MATCHER,
  ROAS_EFFICIENCY_MATCHER,
  AUDIENCE_SATURATION_MATCHER,
  BID_STRATEGY_MATCHER,
  SIGNAL_QUALITY_MATCHER,
  LEARNING_PHASE_MATCHER,
  CREATIVE_ROTATION_MATCHER,
  BUDGET_REALLOCATION_MATCHER,
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Minimum severity to consider for action proposals */
const ACTIONABLE_SEVERITIES = new Set<Severity>(["critical", "warning"]);

/**
 * Analyze diagnostic results and generate action proposals from findings.
 *
 * The engine processes each finding through a set of pattern matchers.
 * Findings with severity >= "warning" are eligible for proposals.
 * Results are sorted by confidence descending.
 */
export function generateRecommendations(diagnostic: DiagnosticResult): RecommendationResult {
  const proposals: ActionProposal[] = [];
  const unactionable: Array<{ finding: Finding; reason: string }> = [];

  for (const finding of diagnostic.findings) {
    // Skip low-severity findings
    if (!ACTIONABLE_SEVERITIES.has(finding.severity)) {
      unactionable.push({
        finding,
        reason: `Severity "${finding.severity}" is below actionable threshold`,
      });
      continue;
    }

    // Try each matcher
    let matched = false;
    for (const matcher of MATCHERS) {
      if (matcher.matches(finding)) {
        const proposal = matcher.propose(finding, diagnostic);
        if (proposal) {
          proposals.push(proposal);
          matched = true;
          break; // One proposal per finding
        }
      }
    }

    if (!matched) {
      unactionable.push({
        finding,
        reason: "No matching action pattern for this finding type",
      });
    }
  }

  // Sort proposals by confidence descending
  proposals.sort((a, b) => b.confidence - a.confidence);

  // Deduplicate proposals with the same actionType + parameters
  const seen = new Set<string>();
  const deduplicated: ActionProposal[] = [];
  for (const proposal of proposals) {
    const key = `${proposal.actionType}:${JSON.stringify(proposal.parameters)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(proposal);
    }
  }

  return {
    proposals: deduplicated,
    unactionable,
    summary: {
      totalFindings: diagnostic.findings.length,
      actionableCount: deduplicated.length,
      unactionableCount: unactionable.length,
      highestConfidence: deduplicated.length > 0 ? deduplicated[0]!.confidence : 0,
    },
  };
}
