export const TEMPLATES = {
  clarification: (question: string, options: string[]) =>
    `I want to help, but I need to confirm:\n${question}\n${options.map((o) => `  - ${o}`).join("\n")}`,

  approval: (summary: string, risk: string, reason: string) =>
    `This action needs your approval:\n\n${summary}\nRisk: ${risk}\nReason: ${reason}`,

  denial: (explanation: string, detail: string) =>
    `Blocked: ${explanation}\n\nWhy: ${detail}`,

  result: (summary: string, approvedBy: string, auditId: string, risk: string, undoAvailable: boolean) =>
    `Done: ${summary}\n\nApproved by: ${approvedBy}\nAudit ID: ${auditId}\nRisk category: ${risk}${undoAvailable ? "\nRollback available: yes (reply 'undo' within 24h)" : ""}`,

  uncertainty: () =>
    "I'm not sure what you're asking me to do. Could you clarify?\n" +
    "I can help with: pause/resume campaigns, adjust budgets, adjust bids.\n" +
    "Reply with what you'd like, or type 'help' for the full list.",
} as const;
