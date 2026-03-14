// ---------------------------------------------------------------------------
// Handoff Notifier — alerts team members via channels
// ---------------------------------------------------------------------------

import type { HandoffPackage } from "./types.js";
import type { ApprovalNotifier } from "../notifications/index.js";

export class HandoffNotifier {
  constructor(private notifier: ApprovalNotifier) {}

  async notify(pkg: HandoffPackage): Promise<void> {
    const message = this.formatMessage(pkg);
    await this.notifier.notify({
      approvalId: pkg.id,
      envelopeId: pkg.sessionId,
      summary: message,
      riskCategory: "medium",
      explanation: `Handoff requested: ${pkg.reason.replace(/_/g, " ")}`,
      bindingHash: "",
      expiresAt: pkg.slaDeadlineAt,
      approvers: [],
      evidenceBundle: { reason: pkg.reason, leadId: pkg.leadSnapshot.leadId },
    });
  }

  private formatMessage(pkg: HandoffPackage): string {
    const lines = [
      `HANDOFF REQUEST`,
      `Reason: ${pkg.reason.replace(/_/g, " ")}`,
      `Lead: ${pkg.leadSnapshot.name ?? "Unknown"} (${pkg.leadSnapshot.channel})`,
    ];

    if (pkg.leadSnapshot.serviceInterest) {
      lines.push(`Interest: ${pkg.leadSnapshot.serviceInterest}`);
    }

    lines.push(`Turns: ${pkg.conversationSummary.turnCount}`);
    lines.push(`Sentiment: ${pkg.conversationSummary.sentiment}`);

    if (pkg.conversationSummary.keyTopics.length > 0) {
      lines.push(`Topics: ${pkg.conversationSummary.keyTopics.join(", ")}`);
    }
    if (pkg.conversationSummary.objectionHistory.length > 0) {
      lines.push(`Objections: ${pkg.conversationSummary.objectionHistory.join(", ")}`);
    }
    if (pkg.conversationSummary.suggestedOpening) {
      lines.push(`\nSuggested opening: "${pkg.conversationSummary.suggestedOpening}"`);
    }

    const slaMinutes = Math.round((pkg.slaDeadlineAt.getTime() - Date.now()) / 60_000);
    lines.push(`\nSLA: ${slaMinutes} minutes remaining`);

    return lines.join("\n");
  }
}
