import type { TeamPulseAgent } from "./types";
import styles from "./home.module.css";

interface TeamPulseProps {
  agents: TeamPulseAgent[];
}

/**
 * TeamPulse — thin presence ribbon of the AI team.
 *
 * Presentational only: receives pre-composed TeamPulseAgent list, never fetches.
 * No onClick, no routes, no panel — Phase 2 will add interactivity.
 *
 * Mira honesty: when setUp is false, the chip is muted and renders "Not set up"
 * as visible text (a trust signal, not an error). Set-up agents show a live/idle dot.
 */
export function TeamPulse({ agents }: TeamPulseProps) {
  return (
    <div className={styles.pulseRibbon}>
      {agents.map((agent) => {
        const { key, name, status, setUp } = agent;
        const isOn = status === "working" && setUp;

        return (
          <div
            key={key}
            className={styles.agentChip}
            data-agent={key}
            data-disabled={String(!setUp)}
            data-testid={`agent-chip-${key}`}
          >
            <span className={styles.agentChipAv}>{name[0]}</span>
            <span className={styles.agentChipName}>{name}</span>
            {setUp ? (
              <span
                className={styles.agentChipStatus}
                data-on={isOn ? "true" : "false"}
                data-testid="agent-status-dot"
              />
            ) : (
              <span
                style={{
                  fontSize: "10px",
                  fontFamily: "var(--mono)",
                  letterSpacing: "0.04em",
                  color: "var(--ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                Not set up
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
