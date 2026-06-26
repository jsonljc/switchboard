// ---------------------------------------------------------------------------
// Handoff Notifier — alerts team members via channels
// ---------------------------------------------------------------------------

import type { Handoff } from "./types.js";
import type { ApprovalNotifier } from "../notifications/index.js";

/**
 * Resolves the escalation recipients for a handoff, PER organization. Injected
 * (core must not read Prisma) and called with pkg.organizationId so one tenant's
 * handoff — which carries leadSnapshot PII — is never broadcast to another
 * tenant's inbox. The api wires this to a stored-recipients-then-verified-users
 * resolver with NO env fallback, mirroring the A17 owner-report recipient
 * isolation. Returns [] when an org has no resolvable recipients: the handoff
 * record is still persisted by the escalate tool, it just isn't notified out.
 */
export type EscalationRecipientResolver = (organizationId: string) => Promise<string[]>;

export class HandoffNotifier {
  constructor(
    private notifier: ApprovalNotifier,
    private resolveApprovers: EscalationRecipientResolver,
  ) {}

  async notify(pkg: Handoff): Promise<void> {
    const message = this.formatMessage(pkg);
    const approvers = await this.resolveApprovers(pkg.organizationId);
    await this.notifier.notify({
      approvalId: pkg.id,
      envelopeId: pkg.sessionId,
      summary: message,
      riskCategory: "medium",
      explanation: `Handoff requested: ${pkg.reason.replace(/_/g, " ")}`,
      bindingHash: "",
      expiresAt: pkg.slaDeadlineAt,
      approvers,
      evidenceBundle: { reason: pkg.reason, leadId: pkg.leadSnapshot.leadId },
    });
  }

  private formatMessage(pkg: Handoff): string {
    const lines = [
      `HANDOFF REQUEST`,
      `Reason: ${pkg.reason.replace(/_/g, " ")}`,
      `Lead: ${pkg.leadSnapshot.name ?? "Unknown"} (${pkg.leadSnapshot.channel})`,
    ];

    if (pkg.leadSnapshot.serviceInterest) {
      lines.push(`Interest: ${pkg.leadSnapshot.serviceInterest}`);
    }

    // P2-9: the escalating agent's own summary of why this handoff is needed.
    // Rendered prominently (before the keyword-derived turn/topic lines) so the
    // operator opens with real context instead of a context-free package.
    if (pkg.conversationSummary.agentSummary) {
      lines.push(`Summary: ${pkg.conversationSummary.agentSummary}`);
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
