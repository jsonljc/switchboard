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
  return (
    `I can help you manage your advertising campaigns. Available actions:\n\n` +
    availableActions.map((a) => `- ${a}`).join("\n") +
    `\n\nExamples:\n` +
    `- "pause Summer Sale"\n` +
    `- "set budget for Brand Awareness to $800"\n` +
    `- "increase budget for Retargeting by $200"\n\n` +
    `Type a command to get started.`
  );
}

export function composeUncertainReply(): string {
  return (
    "I'm not sure what you're asking me to do. Could you clarify?\n" +
    "I can help with: pause/resume campaigns, adjust budgets.\n" +
    "Reply with what you'd like, or type 'help' for the full list."
  );
}
