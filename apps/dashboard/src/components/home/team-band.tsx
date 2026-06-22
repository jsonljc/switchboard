"use client";

import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import type { TeamBandAgent } from "./types";
import styles from "./team-band.module.css";

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
 * Honest role lines (job descriptions, not status claims), from the locked
 * aesthetic-direction mockup. Presentation copy: the registry's `role` field
 * is a machine slug, not display copy.
 */
const ROLE_FOR_AGENT: Record<AgentKey, string> = {
  alex: "Front desk",
  riley: "Ad analyst",
  mira: "The maker",
};

/**
 * TeamBand - the "meet your team" poster, the emotional peak of the locked
 * direction. The crew at fluid hero scale (about 81px at a 320px viewport up to
 * 112px capped) as printed portraits on one tri-radial identity-tint ground
 * under the lighter poster grain, with serif identity names, role lines, and
 * honest live status. One breathing focal avatar (the first genuinely-working
 * agent) which also steps forward (the featured lift). Reduced motion strips
 * the breathing, the hover movement, and the grain; the featured lift remains
 * as a static position (it never animates there). Each cell opens the agent
 * panel. Agent hues are
 * identity-only (grounds, name and role inks, status accents), never on an
 * action surface; the focus ring stays amber.
 */
export function TeamBand({ agents, onOpenAgent }: TeamBandProps) {
  const focalKey = agents.find(
    (a) => a.setUp && !a.halted && (a.status === "working" || a.status === "analyzing"),
  )?.key;

  return (
    <section className={styles.band} aria-label="Your team">
      <h2 className={styles.heading}>Your team</h2>
      <div className={styles.poster} data-testid="team-poster">
        {/* Riso/print registration crop-marks: decorative corner ticks that
            frame the poster like a printed plate. Static, identity-only. */}
        <span
          className={styles.registration}
          aria-hidden="true"
          data-testid="poster-registration"
        />
        <div className={styles.grid} role="list">
          {agents.map((agent) => {
            const { key, name, setUp, halted } = agent;
            const statusLabel = teamStatusLabel(agent);
            const featured = key === focalKey;
            return (
              <div key={key} role="listitem">
                <button
                  type="button"
                  className={styles.mate}
                  data-agent={key}
                  data-disabled={String(!setUp)}
                  data-featured={String(featured)}
                  data-testid={`team-mate-${key}`}
                  aria-label={`Open ${name}, ${statusLabel}`}
                  onClick={() => onOpenAgent?.(key)}
                >
                  <span className={styles.portraitBox}>
                    <PrintedPortraitAvatar
                      agentKey={key}
                      size="fill"
                      hero
                      status={setUp ? agent.status : "idle"}
                      halted={halted}
                      allowMotion={featured}
                      showPip
                    />
                  </span>
                  <span className={styles.mateName}>{name}</span>
                  <span className={styles.mateRole}>{ROLE_FOR_AGENT[key]}</span>
                  <span className={styles.mateStatus}>{statusLabel}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
