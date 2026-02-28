import type { DecisionTrace } from "@switchboard/schemas";

export function composeDenialReply(trace: DecisionTrace): string {
  const deniedCheck = trace.checks.find(
    (c) => c.matched && c.effect === "deny",
  );

  let reply = `Blocked: ${trace.explanation}\n\n`;

  if (deniedCheck) {
    reply += `Why: ${deniedCheck.humanDetail}\n`;
    reply += `Check: ${deniedCheck.checkCode}\n`;
  }

  return reply;
}

export function composeApprovalSummary(
  actionSummary: string,
  riskCategory: string,
  explanation: string,
): string {
  return (
    `This action needs your approval:\n\n` +
    `${actionSummary}\n` +
    `Risk: ${riskCategory.toUpperCase()}\n` +
    `Reason: ${explanation}`
  );
}

export function composeExecutionResult(
  summary: string,
  success: boolean,
  auditId: string,
  riskCategory: string,
  undoAvailable: boolean,
  approvedBy: string,
): string {
  const icon = success ? "Done" : "Failed";
  let reply = `${icon}: ${summary}\n\n`;
  reply += `Approved by: ${approvedBy}\n`;
  reply += `Audit ID: ${auditId}\n`;
  reply += `Risk category: ${riskCategory.toUpperCase()}\n`;

  if (undoAvailable) {
    reply += `Rollback available: yes (reply 'undo' within 24h)`;
  }

  return reply;
}

export function composeHelpMessage(availableActions: string[]): string {
  const sections: string[] = [];

  const hasAds = availableActions.some((a) => a.startsWith("ads."));
  const hasPayments = availableActions.some((a) => a.startsWith("payments."));
  const hasTrading = availableActions.some((a) => a.startsWith("trading."));

  if (hasAds) {
    sections.push(
      `Ads:\n` +
      `- "pause Summer Sale"\n` +
      `- "resume Brand Awareness"\n` +
      `- "set budget for Retargeting to $800"`,
    );
  }
  if (hasPayments) {
    sections.push(
      `Payments:\n` +
      `- "refund $150 for ch_abc"\n` +
      `- "charge cus_123 $500"\n` +
      `- "invoice cus_123 $200 for consulting"\n` +
      `- "cancel subscription sub_1"\n` +
      `- "apply $50 credit to cus_123"\n` +
      `- "create payment link for $100"`,
    );
  }
  if (hasTrading) {
    sections.push(
      `Trading:\n` +
      `- "market buy 100 AAPL"\n` +
      `- "limit sell 50 TSLA at $250"\n` +
      `- "cancel order ord_123"`,
    );
  }

  return (
    `I can help you manage your AI agents. Available actions:\n\n` +
    availableActions.map((a) => `- ${a}`).join("\n") +
    `\n\nExamples:\n` +
    sections.join("\n\n") +
    `\n\nType a command to get started.`
  );
}

export function composeUncertainReply(availableActions?: string[]): string {
  const capabilities: string[] = [];
  if (!availableActions || availableActions.length === 0) {
    capabilities.push("various actions");
  } else {
    if (availableActions.some((a) => a.startsWith("ads."))) {
      capabilities.push("pause/resume campaigns, adjust budgets");
    }
    if (availableActions.some((a) => a.startsWith("payments."))) {
      capabilities.push("refunds, charges, invoices, subscriptions");
    }
    if (availableActions.some((a) => a.startsWith("trading."))) {
      capabilities.push("market/limit orders, position management");
    }
    if (capabilities.length === 0) {
      capabilities.push("various actions");
    }
  }
  return (
    "I'm not sure what you're asking me to do. Could you clarify?\n" +
    `I can help with: ${capabilities.join("; ")}.\n` +
    "Reply with what you'd like, or type 'help' for the full list."
  );
}
