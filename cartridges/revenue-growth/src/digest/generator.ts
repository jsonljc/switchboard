// ---------------------------------------------------------------------------
// Weekly Digest Generator — LLM-backed with template fallback
// ---------------------------------------------------------------------------

import type {
  Intervention,
  ConstraintType,
  WeeklyDigest,
  OutcomeStatus,
  RevGrowthActionType,
} from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";
import type { DiagnosticCycleRecord } from "../stores/interfaces.js";

export async function generateWeeklyDigest(
  accountId: string,
  cycles: DiagnosticCycleRecord[],
  interventions: Intervention[],
  llmClient?: LLMClient,
): Promise<WeeklyDigest> {
  const constraintHistory: ConstraintType[] = cycles
    .filter((c) => c.primaryConstraint !== null)
    .map((c) => c.primaryConstraint as ConstraintType);

  const interventionOutcomes: Array<{
    interventionId: string;
    actionType: RevGrowthActionType;
    outcome: OutcomeStatus;
  }> = interventions.map((i) => ({
    interventionId: i.id,
    actionType: i.actionType,
    outcome: i.outcomeStatus,
  }));

  let headline: string;
  let summary: string;

  if (llmClient) {
    try {
      const { h, s } = await generateWithLLM(
        llmClient,
        accountId,
        constraintHistory,
        interventionOutcomes,
        cycles.length,
      );
      headline = h;
      summary = s;
    } catch {
      ({ headline, summary } = generateFromTemplate(
        accountId,
        constraintHistory,
        interventionOutcomes,
        cycles.length,
      ));
    }
  } else {
    ({ headline, summary } = generateFromTemplate(
      accountId,
      constraintHistory,
      interventionOutcomes,
      cycles.length,
    ));
  }

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());

  return {
    id: crypto.randomUUID(),
    accountId,
    organizationId: cycles[0]?.organizationId ?? "unknown",
    weekStartDate: weekStart.toISOString().split("T")[0]!,
    headline,
    summary,
    constraintHistory,
    interventionOutcomes,
    createdAt: now.toISOString(),
  };
}

async function generateWithLLM(
  llmClient: LLMClient,
  accountId: string,
  constraintHistory: ConstraintType[],
  outcomes: Array<{
    interventionId: string;
    actionType: string;
    outcome: string;
  }>,
  cycleCount: number,
): Promise<{ h: string; s: string }> {
  const prompt = buildLLMPrompt(accountId, constraintHistory, outcomes, cycleCount);
  const response = await llmClient.complete([
    {
      role: "system",
      content:
        "You are a revenue growth advisor writing a weekly account digest. Write a concise headline (1 sentence) and summary (3-5 bullet points). Format: HEADLINE: <headline>\\nSUMMARY:\\n<bullets>",
    },
    { role: "user", content: prompt },
  ]);

  const headlineMatch = response.match(/HEADLINE:\s*(.+)/);
  const summaryMatch = response.match(/SUMMARY:\s*([\s\S]+)/);

  return {
    h: headlineMatch?.[1]?.trim() ?? `Weekly digest for account ${accountId}`,
    s: summaryMatch?.[1]?.trim() ?? response,
  };
}

function buildLLMPrompt(
  accountId: string,
  constraintHistory: ConstraintType[],
  outcomes: Array<{ actionType: string; outcome: string }>,
  cycleCount: number,
): string {
  const lines = [
    `Account: ${accountId}`,
    `Diagnostic cycles this week: ${cycleCount}`,
    `Constraint history: ${constraintHistory.length > 0 ? constraintHistory.join(" → ") : "none"}`,
    `Intervention outcomes:`,
  ];

  if (outcomes.length === 0) {
    lines.push("  - No interventions tracked this week");
  } else {
    for (const o of outcomes) {
      lines.push(`  - ${o.actionType}: ${o.outcome}`);
    }
  }

  return lines.join("\n");
}

function generateFromTemplate(
  _accountId: string,
  constraintHistory: ConstraintType[],
  outcomes: Array<{ actionType: string; outcome: string }>,
  cycleCount: number,
): { headline: string; summary: string } {
  const uniqueConstraints = [...new Set(constraintHistory)];
  const improved = outcomes.filter((o) => o.outcome === "IMPROVED").length;
  const regressed = outcomes.filter((o) => o.outcome === "REGRESSED").length;

  let headline: string;
  if (uniqueConstraints.length === 0) {
    headline = `No binding constraints identified across ${cycleCount} diagnostic cycles`;
  } else if (uniqueConstraints.length === 1) {
    headline = `Primary constraint: ${uniqueConstraints[0]} (${cycleCount} cycles)`;
  } else {
    headline = `Constraint shift detected: ${uniqueConstraints.join(" → ")} (${cycleCount} cycles)`;
  }

  const bullets: string[] = [];
  bullets.push(`- ${cycleCount} diagnostic cycle(s) completed`);

  if (constraintHistory.length > 0) {
    bullets.push(`- Constraint history: ${constraintHistory.join(" → ")}`);
  }

  if (outcomes.length > 0) {
    bullets.push(`- ${outcomes.length} intervention(s) tracked`);
    if (improved > 0) bullets.push(`- ${improved} improved`);
    if (regressed > 0) bullets.push(`- ${regressed} regressed`);
  } else {
    bullets.push("- No interventions tracked this week");
  }

  return { headline, summary: bullets.join("\n") };
}
