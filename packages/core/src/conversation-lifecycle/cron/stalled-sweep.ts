import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { MessageHistoryReader } from "../types.js";
import type { LifecycleModeReader } from "../event-hooks/governance-verdict-escalation-hook.js";
import { STALLED_THRESHOLD_HOURS } from "../constants.js";

export interface StalledSweepCandidate {
  conversationThreadId: string;
  organizationId: string;
  contactId: string;
  currentState: string;
}

export interface StalledSweepDeps {
  writer: LifecycleWriter;
  listNonTerminalSnapshots: () => Promise<StalledSweepCandidate[]>;
  history: MessageHistoryReader;
  readMode: LifecycleModeReader;
  now: Date;
}

// 3a only considers `active` candidates. Other non-terminal states (`escalated`,
// `qualified` in 3b) are deliberately excluded — the cron must not relapse a
// thread once an operator has it or once 3b qualifies it.
const SWEEPABLE_STATES = new Set(["active"]);

export async function runStalledSweep(deps: StalledSweepDeps): Promise<void> {
  const candidates = await deps.listNonTerminalSnapshots();

  // Per-org mode cache so each org pays one readMode call per sweep regardless
  // of candidate count.
  const seenOrgModes = new Map<string, "on" | "off">();
  const modeFor = async (orgId: string): Promise<"on" | "off"> => {
    const cached = seenOrgModes.get(orgId);
    if (cached) return cached;
    const m = await deps.readMode(orgId);
    seenOrgModes.set(orgId, m);
    return m;
  };

  for (const c of candidates) {
    if (!SWEEPABLE_STATES.has(c.currentState)) continue;
    const m = await modeFor(c.organizationId);
    if (m !== "on") continue;
    const { lastAlexOutboundAt, lastInboundAt } = await deps.history.read(c.conversationThreadId);
    if (!lastAlexOutboundAt) continue;
    if (lastInboundAt && lastInboundAt > lastAlexOutboundAt) continue;
    const hoursSince = (deps.now.getTime() - lastAlexOutboundAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince < STALLED_THRESHOLD_HOURS) continue;
    await deps.writer.recordTransition({
      organizationId: c.organizationId,
      conversationThreadId: c.conversationThreadId,
      contactId: c.contactId,
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: {
        last_outbound_at: lastAlexOutboundAt.toISOString(),
        last_inbound_at: lastInboundAt?.toISOString() ?? null,
        hours_since_outbound: Math.round(hoursSince),
      },
      occurredAt: deps.now,
    });
  }
}
