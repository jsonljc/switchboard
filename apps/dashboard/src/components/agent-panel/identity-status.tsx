"use client";

import { InboxAgentAvatar } from "@/components/inbox/inbox-agent-avatar";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentState } from "@/hooks/use-agents";
import { useHalt } from "@/components/layout/halt/halt-context";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { composeStatusLine } from "./lib/status-line";
import type { AgentStateEntry } from "@/lib/api-client-types";
import styles from "./agent-panel.module.css";

/**
 * Per-agent falling-behind threshold in hours.
 * Mirror of packages/core/src/agent-home/greeting.ts busyAgeHoursThreshold.
 * Keep in sync if that constant changes — do NOT import server/core code here.
 */
const FALLING_BEHIND_HOURS: Record<Exclude<PanelAgentKey, "mira">, number> = {
  alex: 24,
  riley: 12,
};

/**
 * Maps canonical agent key → legacy agentRole string returned by /api/agents/state.
 * The state endpoint uses DerivedAgentState which has agentRole (not agentKey).
 */
const AGENT_ROLE_FOR_KEY: Record<Exclude<PanelAgentKey, "mira">, string> = {
  alex: "responder",
  riley: "optimizer",
};

export interface IdentityStatusProps {
  agentKey: PanelAgentKey;
}

export function IdentityStatus({ agentKey }: IdentityStatusProps) {
  const greeting = useAgentGreeting(agentKey);
  const agentStateQuery = useAgentState();
  const { halted } = useHalt();

  const display = agentDisplay[agentKey];
  const nowMs = Date.now();

  // Select this agent's state entry by agentRole (legacy role string from derived state).
  // The runtime shape from /api/agents/state has agentRole, even though the TypeScript
  // type (AgentStateEntry from api-client-types) uses agentRosterId for embedded state.
  // We cast to access the runtime field safely.
  const agentRole =
    agentKey !== "mira" ? AGENT_ROLE_FOR_KEY[agentKey as Exclude<PanelAgentKey, "mira">] : null;
  const stateEntry =
    agentRole != null
      ? (agentStateQuery.data?.states.find(
          (s) => (s as AgentStateEntry & { agentRole?: string }).agentRole === agentRole,
        ) ?? null)
      : null;

  const fallingBehindHours =
    agentKey !== "mira" ? FALLING_BEHIND_HOURS[agentKey as Exclude<PanelAgentKey, "mira">] : 24;

  const statusLine = composeStatusLine({
    oldestOpenItemAgeHours: greeting.data?.signal.oldestOpenItemAgeHours ?? null,
    fallingBehindHours,
    state: stateEntry
      ? {
          lastActionAt:
            (stateEntry as AgentStateEntry & { lastActionAt?: string | null }).lastActionAt ?? null,
        }
      : null,
    nowMs,
  });

  const segments = greeting.data?.segments ?? [];

  return (
    <div className={styles.identityStatus}>
      {/* Identity row: avatar + name/role */}
      <div className={styles.idRowInner}>
        <InboxAgentAvatar agentKey={agentKey} size={44} />
        <div className={styles.agentMeta}>
          <span className={styles.agentName}>{display.name}</span>
          <span className={styles.role}>{display.role}</span>
        </div>
      </div>

      {/* Status section */}
      {halted ? (
        /* Global halt wins — no health read */
        <div className={styles.statusBlock}>
          <span className={styles.pausedBadge}>Paused</span>
          <p className={styles.statusText}>Paused from your workspace controls</p>
        </div>
      ) : (
        <div className={styles.statusBlock}>
          {/* Health PRIMARY (forward signal) */}
          {statusLine.health != null && <p className={styles.healthLine}>{statusLine.health}</p>}
          {/* Presence SECONDARY (backward signal) */}
          {statusLine.presence != null && (
            <p className={styles.presenceLine}>{statusLine.presence}</p>
          )}
        </div>
      )}

      {/* Verdict: all segments joined, accent → <em> */}
      <div className={styles.verdictBlock}>
        {segments.length > 0 ? (
          <p className={styles.verdictText}>
            {segments.map((seg, i) =>
              seg.kind === "accent" ? (
                <em key={i} className={styles.verdictAccent}>
                  {seg.text}
                </em>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </p>
        ) : (
          <p className={styles.verdictEmpty}>No update yet.</p>
        )}
      </div>
    </div>
  );
}
