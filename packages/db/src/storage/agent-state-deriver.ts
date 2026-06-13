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

/** Inactivity window after which a transient "in progress" status is treated as stale. */
export const ACTIVITY_STATUS_STALE_MS = 10 * 60_000; // 10 minutes

/** Statuses asserting the agent is actively doing something right now. */
const TRANSIENT_STATUSES = new Set<DerivedAgentState["activityStatus"]>(["working", "analyzing"]);

/**
 * Decays a transient "working"/"analyzing" status to "idle" once the last action is
 * older than ACTIVITY_STATUS_STALE_MS. Non-transient statuses (waiting_approval, error,
 * idle) are returned unchanged: an outstanding approval or a recorded error is a real
 * state, not a stale in-progress claim.
 *
 * The elapsed comparison is finite-guarded so a missing or invalid timestamp decays to
 * idle rather than silently reading as fresh (a raw `elapsed > stale` is false for NaN).
 */
function decayTransientStatus(
  status: DerivedAgentState["activityStatus"],
  lastActionAt: Date | null,
  now: Date,
): DerivedAgentState["activityStatus"] {
  if (!TRANSIENT_STATUSES.has(status)) return status;
  if (!lastActionAt) return "idle";
  const elapsed = now.getTime() - lastActionAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed > ACTIVITY_STATUS_STALE_MS) return "idle";
  return status;
}

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

export function deriveAgentStates(
  entries: AuditEntryRow[],
  now: Date = new Date(),
): Map<string, DerivedAgentState> {
  const states = new Map<string, DerivedAgentState>();
  const todayStart = new Date(now);
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
    const rawStatus = STATUS_FROM_EVENT[entry.eventType] ?? "idle";
    state.activityStatus = decayTransientStatus(rawStatus, state.lastActionAt, now);

    if (new Date(entry.timestamp) >= todayStart) {
      state.metrics.actionsToday++;
    }
  }

  return states;
}
