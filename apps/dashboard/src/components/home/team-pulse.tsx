import type { AgentKey } from "@switchboard/schemas";
import type { TeamPulseAgent } from "./types";
import styles from "./home.module.css";

interface TeamPulseProps {
  agents: TeamPulseAgent[];
  /** Called when the user taps a chip. All agents — including Mira — are tappable. */
  onOpenAgent?: (key: AgentKey) => void;
}

/**
 * TeamPulse — thin presence ribbon of the AI team.
 *
 * Each chip is a button that calls `onOpenAgent(key)` when tapped.
 * All three agents are tappable — including Mira — whose panel shows the honest
 * "not set up" state (a trust signal, not a dead end).
 *
 * Mira honesty: when setUp is false, the chip is muted and renders "Not set up"
 * as visible text. Set-up agents show a live/idle dot.
 */
export function TeamPulse({ agents, onOpenAgent }: TeamPulseProps) {
  return (
    <div className={styles.pulseRibbon} role="list" aria-label="Team Pulse">
      {agents.map((agent) => {
        const { key, name, status, setUp } = agent;
        const isOn = status === "working" && setUp;

        return (
          <button
            key={key}
            type="button"
            className={styles.agentChip}
            data-agent={key}
            data-disabled={String(!setUp)}
            data-testid={`agent-chip-${key}`}
            role="listitem"
            onClick={() => onOpenAgent?.(key)}
          >
            <span className={styles.agentChipAv} aria-hidden="true">
              {name[0]}
            </span>
            <span className={styles.agentChipName}>{name}</span>
            {setUp ? (
              <span
                className={styles.agentChipStatus}
                data-on={isOn ? "true" : "false"}
                data-testid="agent-status-dot"
                aria-hidden="true"
              />
            ) : (
              <span className={styles.agentChipNotSetUp}>Not set up</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
