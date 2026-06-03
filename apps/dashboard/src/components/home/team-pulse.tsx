import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
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
  const firstWorkingKey = agents.find((a) => a.setUp && a.status === "working")?.key;
  return (
    <div className={styles.pulseRibbon} role="list" aria-label="Team Pulse">
      {agents.map((agent) => {
        const { key, name, status, setUp } = agent;
        const isOn = status === "working" && setUp;

        return (
          <div key={key} role="listitem">
            <button
              type="button"
              className={styles.agentChip}
              data-agent={key}
              data-disabled={String(!setUp)}
              data-testid={`agent-chip-${key}`}
              onClick={() => onOpenAgent?.(key)}
            >
              <PrintedPortraitAvatar
                agentKey={key}
                size={30}
                status={setUp ? status : "idle"}
                allowMotion={key === firstWorkingKey}
                showPip={false}
              />
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
          </div>
        );
      })}
    </div>
  );
}
