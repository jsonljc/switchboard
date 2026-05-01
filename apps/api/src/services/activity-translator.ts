import type { AgentKey } from "@switchboard/schemas";

export interface RawAuditEntry {
  id: string;
  eventType: string;
  timestamp: string;
  actorType: string;
  actorId: string;
  entityType: string;
  entityId: string;
  summary: string;
  snapshot: Record<string, unknown>;
}

export interface TranslatedActivity {
  id: string;
  type: string;
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
  /** Structured agent attribution. null for non-agent actors and unknown agent ids. */
  agent: AgentKey | null;
}

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-/;

function resolveActor(entry: RawAuditEntry): string {
  if (entry.actorType === "owner" || entry.actorType === "operator") return "You";
  if (entry.actorType === "agent") {
    if (!entry.actorId || UUID_PATTERN.test(entry.actorId) || entry.actorId.includes("_")) {
      return "Alex";
    }
    return entry.actorId.charAt(0).toUpperCase() + entry.actorId.slice(1);
  }
  return "System";
}

function resolveDotColor(eventType: string): TranslatedActivity["dotColor"] {
  if (eventType.includes("approved") || eventType.includes("executed")) return "green";
  if (
    eventType.includes("denied") ||
    eventType.includes("rejected") ||
    eventType.includes("failed")
  )
    return "amber";
  if (eventType.startsWith("tool.") || eventType.startsWith("connection.")) return "blue";
  return "gray";
}

function buildDescription(entry: RawAuditEntry): string {
  const actor = resolveActor(entry);
  const summary = entry.summary || "";

  if (summary) {
    const cleaned = summary
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (cleaned.toLowerCase().startsWith(actor.toLowerCase())) {
      return cleaned;
    }
    return `${actor} ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
  }

  return `${actor} performed an action`;
}

/**
 * Returns the structured agent key for an audit entry, or null when the entry
 * isn't attributable to one of our named agents (Alex/Nova/Mira).
 * Non-agent actors (owner/operator/system) always return null.
 */
export function resolveAgentKey(entry: RawAuditEntry): AgentKey | null {
  if (entry.actorType !== "agent") return null;
  const id = (entry.actorId ?? "").toLowerCase();
  if (id.startsWith("alex")) return "alex";
  if (id.startsWith("nova")) return "nova";
  if (id.startsWith("mira")) return "mira";
  return null;
}

export function translateActivity(entry: RawAuditEntry): TranslatedActivity {
  return {
    id: entry.id,
    type: entry.eventType,
    description: buildDescription(entry),
    dotColor: resolveDotColor(entry.eventType),
    createdAt: entry.timestamp,
    agent: resolveAgentKey(entry),
  };
}

export function translateActivities(entries: RawAuditEntry[], limit = 8): TranslatedActivity[] {
  return entries.slice(0, limit).map(translateActivity);
}
