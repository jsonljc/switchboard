// apps/dashboard/src/lib/cockpit/activity-kind-map.ts
import type { TranslatedAction } from "@/hooks/use-agent-activity";
import type { ActivityKind, ActivityRow } from "@/components/cockpit/types";

const KIND_RULES: Array<{ test: (e: string) => boolean; kind: ActivityKind }> = [
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
  { test: (e) => e === "message.sent" || e === "message.replied", kind: "replied" },
  { test: (e) => e === "message.batch_sent" || e === "campaign.sent", kind: "sent" },
  { test: (e) => e === "system.daily_scan_started" || e === "system.run.started", kind: "started" },
  { test: (e) => e === "lead.created" || e === "leads.ingested", kind: "connected" },
];

function classify(eventType: string): ActivityKind {
  for (const rule of KIND_RULES) {
    if (rule.test(eventType)) return rule.kind;
  }
  return "sent";
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

export function translatedActionToActivityRow(
  action: TranslatedAction,
  now: Date = new Date(),
): ActivityRow {
  return {
    time: formatTime(action.timestamp, now),
    kind: classify(action.eventType),
    head: action.text,
  };
}
