/**
 * Derives agent activity state from recent AuditEntry events.
 * Maps event types to agent roles and computes current status.
 * Called on-demand by the API route, not a daemon.
 */

export interface DerivedAgentState {
  agentRole: string;
  activityStatus: "idle" | "working" | "analyzing" | "waiting_approval" | "error";
  currentTask: string | null;
  lastActionAt: Date | null;
  lastActionSummary: string | null;
  metrics: { actionsToday: number };
}

interface AuditEntryRow {
  eventType: string;
  timestamp: Date;
  summary: string;
}

const ROLE_EVENT_PATTERNS: Record<string, RegExp> = {
  strategist: /campaign|budget|strategy|plan/i,
  monitor: /monitor|anomaly|pacing|alert|health/i,
  responder: /lead|conversation|qualify|respond|message|reply/i,
  optimizer: /optimize|bid|targeting|adjust/i,
  booker: /appointment|book|schedule|calendar/i,
  guardian: /governance|denied|block|restrict|forbidden/i,
};

const STATUS_FROM_EVENT: Record<string, DerivedAgentState["activityStatus"]> = {
  "action.pending_approval": "waiting_approval",
  "action.denied": "idle",
  "action.executed": "idle",
  "action.proposed": "working",
  "action.error": "error",
};

function eventToRole(eventType: string, summary: string): string {
  const combined = `${eventType} ${summary}`;
  for (const [role, pattern] of Object.entries(ROLE_EVENT_PATTERNS)) {
    if (pattern.test(combined)) return role;
  }
  return "primary_operator";
}

function deriveTaskDescription(eventType: string, summary: string): string {
  if (summary && summary.length > 0) return summary;
  const parts = eventType.split(".");
  if (parts.length > 1) {
    const first = parts[0]!;
    return `${first.charAt(0).toUpperCase() + first.slice(1)} ${parts.slice(1).join(" ")}`;
  }
  return eventType;
}

export function deriveAgentStates(entries: AuditEntryRow[]): Map<string, DerivedAgentState> {
  const states = new Map<string, DerivedAgentState>();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Initialize all roles with idle state
  const allRoles = [
    "strategist",
    "monitor",
    "responder",
    "optimizer",
    "booker",
    "guardian",
    "primary_operator",
  ];
  for (const role of allRoles) {
    states.set(role, {
      agentRole: role,
      activityStatus: "idle",
      currentTask: null,
      lastActionAt: null,
      lastActionSummary: null,
      metrics: { actionsToday: 0 },
    });
  }

  // Process entries from oldest to newest to get latest state
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  for (const entry of sorted) {
    const role = eventToRole(entry.eventType, entry.summary);
    const state = states.get(role)!;

    state.lastActionAt = new Date(entry.timestamp);
    state.lastActionSummary = entry.summary;
    state.currentTask = deriveTaskDescription(entry.eventType, entry.summary);
    state.activityStatus = STATUS_FROM_EVENT[entry.eventType] ?? "idle";

    if (new Date(entry.timestamp) >= todayStart) {
      state.metrics.actionsToday++;
    }
  }

  return states;
}
