/**
 * Translates raw audit event data into plain English.
 * Maps eventType + entityType + snapshot into human-readable summaries.
 */

const eventTranslations: Record<string, (entry: {
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
  snapshot: Record<string, unknown>;
}) => string> = {
  "action.executed": (e) => {
    const snap = e.snapshot;
    const actionType = (snap.actionType as string) ?? e.entityType;
    const amount = snap.dollarsAtRisk as number | undefined;

    // Payment-specific translations (check before generic patterns)
    if (actionType.includes("refund")) {
      return `AI issued a ${amount ? `$${amount} ` : ""}refund`;
    }
    if (actionType.includes("charge.create")) {
      return `AI charged ${amount ? `$${amount}` : "a customer"}`;
    }
    if (actionType.includes("invoice")) {
      return `AI created a ${amount ? `$${amount} ` : ""}invoice`;
    }
    if (actionType.includes("subscription.cancel")) {
      return `AI cancelled a subscription`;
    }
    if (actionType.includes("subscription.modify")) {
      return `AI modified a subscription`;
    }
    if (actionType.includes("credit")) {
      return `AI applied a ${amount ? `$${amount} ` : ""}credit`;
    }
    if (actionType.includes("batch")) {
      return `AI sent batch invoices${amount ? ` ($${amount} total)` : ""}`;
    }
    if (actionType.includes("link.create")) {
      return `AI created a ${amount ? `$${amount} ` : ""}payment link`;
    }

    if (actionType.includes("setBudget") || actionType.includes("budget")) {
      return `AI set your daily budget to ${amount ? `$${amount}` : "a new value"}`;
    }
    if (actionType.includes("pause") || actionType.includes("Pause")) {
      return `AI paused ${e.entityType} ${e.entityId}`;
    }
    if (actionType.includes("enable") || actionType.includes("Enable")) {
      return `AI enabled ${e.entityType} ${e.entityId}`;
    }
    if (actionType.includes("create") || actionType.includes("Create")) {
      return `AI created a new ${e.entityType}`;
    }
    if (actionType.includes("update") || actionType.includes("Update")) {
      return `AI updated ${e.entityType} ${e.entityId}`;
    }
    if (amount) {
      return `AI executed ${actionType} ($${amount} at risk)`;
    }
    return e.summary || `AI executed ${actionType}`;
  },

  "action.denied": (e) => {
    const snap = e.snapshot;
    const reason = (snap.reason as string) ?? "policy violation";
    return `AI action blocked: ${reason}`;
  },

  "action.approved": (e) => {
    const snap = e.snapshot;
    const approver = (snap.respondedBy as string) ?? "an approver";
    return `Action approved by ${approver}`;
  },

  "action.rejected": (e) => {
    const snap = e.snapshot;
    const approver = (snap.respondedBy as string) ?? "an approver";
    return `Action rejected by ${approver}`;
  },

  "action.failed": (e) => {
    const snap = e.snapshot;
    const error = (snap.error as string) ?? "unknown error";
    return `Action failed: ${error}`;
  },

  "action.proposed": (e) => {
    const snap = e.snapshot;
    const actionType = (snap.actionType as string) ?? e.entityType;
    return `AI proposed: ${actionType}`;
  },

  "action.queued": () => "Action queued for execution",

  "action.expired": () => "Approval request expired",

  "action.undo_executed": (e) => {
    return `Undo executed for ${e.entityType} ${e.entityId}`;
  },

  "policy.created": (e) => {
    const snap = e.snapshot;
    const name = (snap.policy as Record<string, unknown>)?.name ?? "policy";
    return `Policy "${name}" created`;
  },

  "policy.updated": (e) => {
    const snap = e.snapshot;
    const name = (snap.current as Record<string, unknown>)?.name ?? "policy";
    return `Policy "${name}" updated`;
  },

  "policy.deleted": (e) => {
    const snap = e.snapshot;
    const name = (snap.deletedPolicy as Record<string, unknown>)?.name ?? "policy";
    return `Policy "${name}" deleted`;
  },

  "identity.created": () => "Identity spec created",
  "identity.updated": () => "Identity settings updated",

  "connection.established": (e) => `Connected to ${e.entityId}`,
  "connection.degraded": (e) => `Connection issue with ${e.entityId}`,
};

export function translateEvent(entry: {
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
  snapshot: Record<string, unknown>;
}): string {
  const translator = eventTranslations[entry.eventType];
  if (translator) {
    return translator(entry);
  }
  return entry.summary || entry.eventType.replace(/\./g, " ");
}

export function getEventIcon(eventType: string): "success" | "denied" | "pending" | "info" | "warning" {
  if (eventType.includes("executed") || eventType.includes("approved")) return "success";
  if (eventType.includes("denied") || eventType.includes("rejected") || eventType.includes("failed")) return "denied";
  if (eventType.includes("proposed") || eventType.includes("queued")) return "pending";
  if (eventType.includes("degraded") || eventType.includes("expired")) return "warning";
  return "info";
}

export function getEventFilterCategory(eventType: string): string {
  if (eventType.startsWith("action.executed")) return "Executed";
  if (eventType.startsWith("action.denied") || eventType.startsWith("action.rejected")) return "Denied";
  if (eventType.startsWith("action.approved") || eventType.startsWith("action.proposed") || eventType.includes("approval")) return "Approvals";
  if (eventType.startsWith("policy.") || eventType.startsWith("identity.") || eventType.startsWith("connection.")) return "Settings";
  return "All";
}
