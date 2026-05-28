import type { ActivityKind, ActivityRow } from "@/components/cockpit/types";

export function composeActivityVoice(row: ActivityRow): string {
  const who = row.who;
  switch (row.kind) {
    case "replied":
      return who ? `I replied to ${who} ${row.head}` : `I replied to a lead ${row.head}`;
    case "booked":
      return who ? `I booked ${who}'s consult ${row.head}` : `I booked a consult ${row.head}`;
    case "qualified":
      return `I qualified ${row.head}`;
    case "sent":
      return `I sent ${row.head}`;
    case "escalated":
      return who ? `I escalated ${who} to you — ${row.head}` : `I escalated to you — ${row.head}`;
    case "paused":
      return `I paused ${row.head}`;
    case "scaled":
      return `I scaled ${row.head}`;
    case "shifted":
    case "rotated":
    case "restructured":
      return `I adjusted ${row.head}`;
    default:
      return `I noted ${row.head}`;
  }
}

// Completeness-guarded kind list — TS errors here if a kind is missing from the enum,
// keeping this list in sync with ActivityKind.
const ACTIVITY_KINDS = {
  booked: 1,
  qualified: 1,
  replied: 1,
  sent: 1,
  started: 1,
  connected: 1,
  waiting: 1,
  escalated: 1,
  passed: 1,
  watching: 1,
  reviewing: 1,
  paused: 1,
  scaled: 1,
  rotated: 1,
  shifted: 1,
  restructured: 1,
  alert: 1,
  observed: 1,
} satisfies Record<ActivityKind, 1>;

export const KNOWN_ACTIVITY_KINDS = Object.keys(ACTIVITY_KINDS) as ActivityKind[];
