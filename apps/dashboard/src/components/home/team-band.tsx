"use client";

import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import type { TeamBandAgent } from "./types";
import styles from "./home.module.css";

interface TeamBandProps {
  agents: TeamBandAgent[];
  /** Tap a tile to open that agent's panel. All three are tappable, including Mira. */
  onOpenAgent?: (key: AgentKey) => void;
}

/**
 * Honest, calm status word from real per-agent state. No fabricated specifics
 * (no invented client names or counts). Halt wins; loading never reads as
 * "Not set up".
 */
export function teamStatusLabel(a: TeamBandAgent): string {
  if (a.halted) return "Asleep";
  if (!a.setUp) return a.setupLoading ? "Checking setup" : "Not set up yet";
  switch (a.status) {
    case "working":
    case "analyzing":
      return "Working";
    case "waiting_approval":
    case "error":
      return "Needs you";
    default:
      return "Ready";
  }
}

/**
 * TeamBand - the "your team today" hero band. The crew at hero scale (96px) on
 * their identity grounds, with name and honest live status. One breathing
 * focal avatar (the first genuinely-working agent); reduced motion strips it.
 * Each tile opens the agent panel. Agent hues are identity-only (portrait
 * ground + status accent), never on an action surface.
 */
export function TeamBand({ agents, onOpenAgent }: TeamBandProps) {
  const focalKey = agents.find(
    (a) => a.setUp && !a.halted && (a.status === "working" || a.status === "analyzing"),
  )?.key;

  return (
    <section className={styles.teamBand} aria-label="Your team">
      <h2 className={styles.teamBandHeading}>Your team</h2>
      <div className={styles.teamBandGrid} role="list">
        {agents.map((agent) => {
          const { key, name, setUp, halted } = agent;
          const statusLabel = teamStatusLabel(agent);
          return (
            <div key={key} role="listitem">
              <button
                type="button"
                className={styles.teamMate}
                data-agent={key}
                data-disabled={String(!setUp)}
                data-testid={`team-mate-${key}`}
                aria-label={`Open ${name}, ${statusLabel}`}
                onClick={() => onOpenAgent?.(key)}
              >
                <PrintedPortraitAvatar
                  agentKey={key}
                  size={88}
                  status={setUp ? agent.status : "idle"}
                  halted={halted}
                  allowMotion={key === focalKey}
                  showPip
                />
                <span className={styles.teamMateName}>{name}</span>
                <span className={styles.teamMateStatus}>{statusLabel}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
