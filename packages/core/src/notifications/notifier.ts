import type { ApprovalRequest, DecisionTrace } from "@switchboard/schemas";

export interface ApprovalNotification {
  approvalId: string;
  envelopeId: string;
  summary: string;
  riskCategory: string;
  explanation: string;
  bindingHash: string;
  expiresAt: Date;
  approvers: string[];
  evidenceBundle: Record<string, unknown>;
}

export interface ApprovalNotifier {
  notify(notification: ApprovalNotification): Promise<void>;
}

export class NoopNotifier implements ApprovalNotifier {
  async notify(_notification: ApprovalNotification): Promise<void> {
    // No-op: used when no notification channel is configured
  }
}

export class CompositeNotifier implements ApprovalNotifier {
  private notifiers: ApprovalNotifier[];

  constructor(notifiers: ApprovalNotifier[]) {
    this.notifiers = notifiers;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    await Promise.allSettled(
      this.notifiers.map((n) => n.notify(notification)),
    );
  }
}

export function buildApprovalNotification(
  request: ApprovalRequest,
  trace: DecisionTrace,
): ApprovalNotification {
  return {
    approvalId: request.id,
    envelopeId: request.envelopeId,
    summary: request.summary,
    riskCategory: request.riskCategory,
    explanation: trace.explanation,
    bindingHash: request.bindingHash,
    expiresAt: request.expiresAt,
    approvers: request.approvers,
    evidenceBundle: request.evidenceBundle as Record<string, unknown>,
  };
}
