import type { ActivityKind, ActivityRow, ThreadMessage } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import type { ActivityPreviewReader } from "./activity-preview-reader.js";
import { extractContactRef } from "./contact-snapshot-extractors.js";

export interface AuditEntryForTranslator {
  id: string;
  eventType: string;
  timestamp: string;
  actorType: string;
  actorId: string;
  snapshot: Record<string, unknown>;
}

export interface TranslateAuditToCockpitActivityArgs {
  entries: readonly AuditEntryForTranslator[];
  previewReader: ActivityPreviewReader;
  orgId: string;
  agentKey: AgentKey;
  limit: number;
  expandPreview: boolean;
  now?: Date;
}

// Legacy actor-to-agent convention (verified against
// apps/dashboard/src/hooks/use-agent-activity.ts:44 +
// apps/api/src/services/activity-translator.ts:25-31).
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-/i;

function actorMatchesAgent(entry: AuditEntryForTranslator, agentKey: AgentKey): boolean {
  if (entry.actorType !== "agent") return false;
  if (entry.actorId === agentKey) return true;
  const snapshotRole =
    typeof entry.snapshot.agentRole === "string" ? entry.snapshot.agentRole : null;
  if (snapshotRole === agentKey) return true;
  // Legacy fallback: agent emitters that wrote a UUID actorId AND no
  // agentRole signal pre-date the canonical-key convention. Treat as
  // alex only when there's no other agent attribution at all.
  if (agentKey === "alex" && snapshotRole === null && UUID_PATTERN.test(entry.actorId)) {
    return true;
  }
  return false;
}

const KIND_RULES: Array<{
  test: (e: string) => boolean;
  kind: ActivityKind;
}> = [
  { test: (e) => e.startsWith("booking."), kind: "booked" },
  {
    test: (e) => e === "lifecycle.qualified" || e === "lifecycle.qualified.advanced",
    kind: "qualified",
  },
  {
    test: (e) => e.startsWith("lifecycle.disqualified") || e === "lifecycle.passed",
    kind: "passed",
  },
  { test: (e) => e === "approval.created", kind: "waiting" },
  { test: (e) => e.startsWith("escalation."), kind: "escalated" },
  { test: (e) => e === "message.batch_sent" || e === "campaign.sent", kind: "sent" },
  { test: (e) => e === "message.sent" || e === "message.replied", kind: "replied" },
  { test: (e) => e === "system.daily_scan_started" || e === "system.run.started", kind: "started" },
  { test: (e) => e === "lead.created" || e === "leads.ingested", kind: "connected" },
];

function classify(eventType: string): ActivityKind {
  for (const rule of KIND_RULES) if (rule.test(eventType)) return rule.kind;
  return "replied";
}

function formatTime(timestamp: string, now: Date): string {
  const then = new Date(timestamp);
  const sameDay = then.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameDay) {
    const hh = String(then.getUTCHours()).padStart(2, "0");
    const mm = String(then.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const days = Math.floor((now.getTime() - then.getTime()) / (24 * 3600 * 1000));
  if (days < 7) {
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return WEEKDAYS[then.getUTCDay()]!;
  }
  return then.toISOString().slice(5, 10);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function deepKey(snapshot: Record<string, unknown>, top: string, leaf: string): string | null {
  const nested = snapshot[top];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return asString((nested as Record<string, unknown>)[leaf]);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildHead(
  kind: ActivityKind,
  snapshot: Record<string, unknown>,
  contactName: string | null,
): string {
  const name = contactName ?? "";
  switch (kind) {
    case "booked": {
      const service = deepKey(snapshot, "booking", "service");
      const when = deepKey(snapshot, "booking", "when");
      if (name && service && when) return `${name} confirmed ${service} ${when}`;
      return "Booking confirmed";
    }
    case "qualified": {
      const qualifier = asString(snapshot.qualifier);
      if (name && qualifier) return `${name} qualified — ${qualifier}`;
      if (name) return `${name} qualified`;
      return "Lead qualified";
    }
    case "replied": {
      const topic = asString(snapshot.topic) ?? deepKey(snapshot, "message", "topic");
      if (name && topic) return `${name} · ${topic}`;
      if (name) return `${name} replied`;
      return "Reply sent";
    }
    case "sent": {
      const n =
        asNumber(deepKey(snapshot, "message", "count") as unknown) ?? asNumber(snapshot.count);
      if (n) return `Morning batch · ${n} follow-ups`;
      return "Batch sent";
    }
    case "started": {
      return "Daily run begins";
    }
    case "connected": {
      const n =
        asNumber(snapshot.count) ?? asNumber(deepKey(snapshot, "batch", "count") as unknown);
      const source =
        asString(snapshot.source) ?? asString(deepKey(snapshot, "batch", "source") as unknown);
      if (n && source) return `Pulled ${n} new leads from ${source}`;
      if (n) return `Pulled ${n} new leads`;
      return "New leads pulled";
    }
    case "waiting": {
      const topic = asString(snapshot.topic) ?? deepKey(snapshot, "approval", "topic");
      if (topic) return `Awaiting your call on ${topic}`;
      return "Awaiting your call";
    }
    case "escalated": {
      const topic = asString(snapshot.topic) ?? deepKey(snapshot, "escalation", "topic");
      if (name && topic) return `${topic} from ${name} → your inbox`;
      if (topic) return `${topic} → your inbox`;
      return "Escalated to your inbox";
    }
    case "passed": {
      const reason = asString(snapshot.reason) ?? deepKey(snapshot, "disqualification", "reason");
      if (name && reason) return `${name} — ${reason}`;
      if (name) return `${name}`;
      return "Passed";
    }
    default:
      return "";
  }
}

function buildBody(
  kind: ActivityKind,
  snapshot: Record<string, unknown>,
  preview: ThreadMessage[] | undefined,
): string | undefined {
  switch (kind) {
    case "booked": {
      const note = deepKey(snapshot, "booking", "note");
      return note ? `Calendar held. ${note}` : "Calendar held.";
    }
    case "qualified": {
      const inbound = preview?.find((m) => m.from === "contact")?.text;
      return inbound ? inbound.slice(0, 120) : "Qualified.";
    }
    case "replied": {
      const summary = asString(snapshot.summary) ?? deepKey(snapshot, "message", "summary");
      if (summary) return summary.slice(0, 120);
      const outbound = preview?.find((m) => m.from === "alex")?.text;
      return outbound ? outbound.slice(0, 120) : undefined;
    }
    case "sent": {
      const tmpl = asString(snapshot.template) ?? deepKey(snapshot, "template", "name");
      const filter = asString(snapshot.filter) ?? deepKey(snapshot, "template", "filter");
      const joined = [tmpl, filter].filter(Boolean).join(" · ");
      return joined || undefined;
    }
    case "started": {
      const quietHours = asString(snapshot.quietHours);
      return quietHours ? `Quiet hours: ${quietHours}` : "Daily run begins.";
    }
    case "connected": {
      const n = asNumber(snapshot.count);
      const source = asString(snapshot.source);
      if (n && source) return `${n} new leads · ${source}`;
      return "New leads pulled.";
    }
    case "waiting": {
      return (
        asString(snapshot.summary) ??
        deepKey(snapshot, "approval", "summary") ??
        "Awaiting your call."
      );
    }
    case "escalated": {
      return (
        asString(snapshot.reason) ??
        deepKey(snapshot, "escalation", "reason") ??
        "Routed to your inbox."
      );
    }
    case "passed": {
      return (
        asString(snapshot.reason) ?? deepKey(snapshot, "disqualification", "reason") ?? "Passed."
      );
    }
    default:
      return undefined;
  }
}

function buildTag(kind: ActivityKind, snapshot: Record<string, unknown>): string | undefined {
  if (kind === "sent") {
    const n =
      asNumber(deepKey(snapshot, "message", "count") as unknown) ?? asNumber(snapshot.count);
    if (n) return `+${n}`;
  }
  return undefined;
}

function dropCreatedAt(
  records: ReadonlyArray<{
    from: "contact" | "alex" | "operator";
    text: string;
    createdAt: string;
  }>,
): ThreadMessage[] {
  return records.map((r) => ({ from: r.from, text: r.text }));
}

export async function translateAuditToCockpitActivity(
  args: TranslateAuditToCockpitActivityArgs,
): Promise<ActivityRow[]> {
  const now = args.now ?? new Date();

  // Filter to entries matching the requested agent. Limit clamping is
  // owned by the API route (which passes a Prisma `take`), so the
  // translator does not re-clamp — it consumes whatever it's given.
  const matching = args.entries.filter((e) => actorMatchesAgent(e, args.agentKey));

  type Staged = {
    entry: AuditEntryForTranslator;
    kind: ActivityKind;
    contactRef: ReturnType<typeof extractContactRef>;
  };
  const staged: Staged[] = matching.map((entry) => ({
    entry,
    kind: classify(entry.eventType),
    contactRef: extractContactRef(entry.eventType, entry.snapshot),
  }));

  const uniqueContactIds = Array.from(
    new Set(staged.map((s) => s.contactRef?.contactId).filter((v): v is string => !!v)),
  );

  const previews: Record<string, ThreadMessage[]> = {};
  if (args.expandPreview && uniqueContactIds.length > 0) {
    const batch = await args.previewReader.readRecentBatch({
      contactIds: uniqueContactIds,
      orgId: args.orgId,
      limit: 4,
    });
    for (const id of uniqueContactIds) {
      previews[id] = dropCreatedAt(batch[id] ?? []);
    }
  }

  return staged.map(({ entry, kind, contactRef }) => {
    const preview = contactRef ? previews[contactRef.contactId] : undefined;
    const row: ActivityRow = {
      id: entry.id,
      time: formatTime(entry.timestamp, now),
      kind,
      head: buildHead(kind, entry.snapshot, contactRef?.displayName ?? null),
      timestampIso: entry.timestamp,
    };
    const body = buildBody(kind, entry.snapshot, preview);
    if (body) row.body = body;
    if (contactRef) {
      row.who = contactRef.displayName;
      row.contactId = contactRef.contactId;
    }
    if (preview && preview.length > 0) {
      row.preview = preview;
      row.replyable = true;
    } else {
      row.replyable = false;
    }
    const tag = buildTag(kind, entry.snapshot);
    if (tag) row.tag = tag;
    return row;
  });
}
