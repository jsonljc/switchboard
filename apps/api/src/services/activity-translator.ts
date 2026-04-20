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

export function translateActivity(entry: RawAuditEntry): TranslatedActivity {
  return {
    id: entry.id,
    type: entry.eventType,
    description: buildDescription(entry),
    dotColor: resolveDotColor(entry.eventType),
    createdAt: entry.timestamp,
  };
}

export function translateActivities(entries: RawAuditEntry[], limit = 8): TranslatedActivity[] {
  return entries.slice(0, limit).map(translateActivity);
}
