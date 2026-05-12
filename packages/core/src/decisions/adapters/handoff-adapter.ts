import type { ConversationThread, Contact } from "@switchboard/schemas";
import type { HandoffPackage } from "../../handoff/types.js";
import type { Decision, DecisionPresentation } from "../types.js";
import { scoreHandoff } from "../urgency.js";
import { resolveAgentKey } from "../agent-key-resolver.js";

export function adaptHandoff(
  row: HandoffPackage,
  contact: Contact | null,
  thread: ConversationThread | null,
): Decision {
  const agentKey = thread?.assignedAgent ? resolveAgentKey(thread.assignedAgent) : "alex";
  return {
    id: `handoff:${row.id}`,
    kind: "handoff",
    orgId: row.organizationId,
    agentKey,
    humanSummary: composeHandoffSummary(row, contact),
    presentation: composeHandoffPresentation(),
    urgencyScore: scoreHandoff(row),
    createdAt: row.createdAt,
    threadHref: thread ? `/contacts/${contact?.id}/conversations/${thread.id}` : null,
    sourceRef: { kind: "handoff", sourceId: row.id },
    meta: {
      contactName: contact?.name ?? undefined,
      slaDeadlineAt: row.slaDeadlineAt,
    },
  };
}

function composeHandoffSummary(row: HandoffPackage, contact: Contact | null): string {
  const who = contact?.name ?? "A lead";
  switch (row.reason) {
    case "human_requested":
      return `${who} asked to talk to a human about their consultation.`;
    case "max_turns_exceeded":
      return `${who} has been going back and forth — I think you should take this one.`;
    case "outside_whatsapp_window":
      return `WhatsApp outbound blocked: outside 24h window and no fitting approved template (or missing opt-in).`;
    default:
      return `${who} needs a human to take over.`;
  }
}

function composeHandoffPresentation(): DecisionPresentation {
  return {
    primaryLabel: "Take this one",
    secondaryLabel: "Snooze",
    dismissLabel: "Mark resolved",
    dataLines: [],
  };
}
