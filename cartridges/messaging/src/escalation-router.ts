// ---------------------------------------------------------------------------
// Escalation Router — 4-step owner reply matching
// ---------------------------------------------------------------------------

export interface EscalationMessage {
  escalationId: string;
  organizationId: string;
  contactId: string;
  agentId: string;
  reason: string;
  messageId: string;
  correlationId: string;
  createdAt: string;
  status: "open" | "closed";
}

export interface OwnerReply {
  message: string;
  contextMessageId?: string;
}

export interface AmbiguousResult {
  match: EscalationMessage | null;
  ambiguous: boolean;
  openEscalations: EscalationMessage[];
}

export interface EscalationRouterConfig {
  maxOpenEscalations?: number;
}

const REF_PATTERN = /\[REF:([^\]]+)\]/;

export class EscalationRouter {
  private escalations = new Map<string, EscalationMessage[]>();

  addEscalation(escalation: EscalationMessage): void {
    const orgEscalations = this.escalations.get(escalation.organizationId) ?? [];
    orgEscalations.push(escalation);
    this.escalations.set(escalation.organizationId, orgEscalations);
  }

  resolve(organizationId: string, escalationId: string): void {
    const orgEscalations = this.escalations.get(organizationId);
    if (!orgEscalations) return;
    const esc = orgEscalations.find((e) => e.escalationId === escalationId);
    if (esc) {
      esc.status = "closed";
    }
  }

  matchReply(organizationId: string, reply: OwnerReply): EscalationMessage | null {
    const openEscalations = this.getOpen(organizationId);
    if (openEscalations.length === 0) return null;

    // Step 1: WhatsApp reply-to threading
    if (reply.contextMessageId) {
      const match = openEscalations.find((e) => e.messageId === reply.contextMessageId);
      if (match) return match;
    }

    // Step 2: [REF:xxx] extraction
    const refMatch = REF_PATTERN.exec(reply.message);
    if (refMatch) {
      const refId = refMatch[1];
      const match = openEscalations.find((e) => e.escalationId === refId);
      if (match) return match;
    }

    // Step 4: Numbered list selection (before recency to handle "2" as a selection)
    const trimmed = reply.message.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= openEscalations.length && trimmed === String(num)) {
      const sorted = this.sortByRecency(openEscalations);
      return sorted[num - 1] ?? null;
    }

    // Step 3: Recency fallback — only when exactly 1 open escalation
    if (openEscalations.length === 1) {
      return openEscalations[0]!;
    }

    // Multiple open and no specific match — ambiguous, return null
    return null;
  }

  matchReplyOrAmbiguate(organizationId: string, reply: OwnerReply): AmbiguousResult {
    const openEscalations = this.getOpen(organizationId);
    if (openEscalations.length === 0) {
      return { match: null, ambiguous: false, openEscalations: [] };
    }

    // Step 1: WhatsApp reply-to threading
    if (reply.contextMessageId) {
      const match = openEscalations.find((e) => e.messageId === reply.contextMessageId);
      if (match) return { match, ambiguous: false, openEscalations };
    }

    // Step 2: [REF:xxx] extraction
    const refMatch = REF_PATTERN.exec(reply.message);
    if (refMatch) {
      const refId = refMatch[1];
      const match = openEscalations.find((e) => e.escalationId === refId);
      if (match) return { match, ambiguous: false, openEscalations };
    }

    // Step 4: Numbered list selection
    const trimmed = reply.message.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= openEscalations.length && trimmed === String(num)) {
      const sorted = this.sortByRecency(openEscalations);
      const match = sorted[num - 1] ?? null;
      return { match, ambiguous: false, openEscalations };
    }

    // Step 3: Recency fallback
    if (openEscalations.length === 1) {
      return { match: openEscalations[0]!, ambiguous: false, openEscalations };
    }

    // Ambiguous — multiple open, no threading/ref/number
    return { match: null, ambiguous: true, openEscalations };
  }

  private getOpen(organizationId: string): EscalationMessage[] {
    return (this.escalations.get(organizationId) ?? []).filter((e) => e.status === "open");
  }

  private sortByRecency(escalations: EscalationMessage[]): EscalationMessage[] {
    return [...escalations].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}
