"use client";

import { useEffect, useState } from "react";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import type { AgentActivity } from "@/components/agent-avatar/agent-status-visual";
import styles from "./mira-header.module.css";

export interface MiraHeaderProps {
  /** Live activity for the avatar (pip + draft animation). Honest default: idle. */
  status?: AgentActivity;
  halted: boolean;
  /** Mono status line under the name (mission subtitle or the feed count line). */
  subtitle: string;
  /** Greeting prose (from useAgentGreeting). */
  line: string | null;
  /** With missionInteractive, turns the subtitle into the mission-popover trigger. */
  onOpenMission?: () => void;
  missionInteractive?: boolean;
}

/**
 * Mira's surface header: the canonical printed-portrait identity (one frame
 * everywhere) replacing the legacy cockpit Identity letter-monogram. The
 * mission trigger renders only after hydration: mission data arrives via React
 * Query and can be present at first client render but never in server HTML,
 * which previously caused a live hydration mismatch on /mira and /mira/review.
 *
 * Promotion note: if Alex/Riley ever get a surface header, generalize via the
 * data-agent deep-ink pattern (inbox .ds-head-name), not by forking this file.
 */
export function MiraHeader({
  status = "idle",
  halted,
  subtitle,
  line,
  onOpenMission,
  missionInteractive = false,
}: MiraHeaderProps) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const interactive = hydrated && missionInteractive && !!onOpenMission;

  return (
    <div className={styles.header}>
      <PrintedPortraitAvatar agentKey="mira" size={56} status={status} halted={halted} />
      <div className={styles.text}>
        <h1 className={styles.name}>Mira</h1>
        <div className={styles.subtitle}>
          {interactive ? (
            <button
              type="button"
              onClick={onOpenMission}
              title="Edit Mira's mission"
              className={styles.missionBtn}
            >
              <span>{subtitle}</span>
              <span className={styles.editGlyph} aria-hidden="true">
                ✎
              </span>
            </button>
          ) : (
            subtitle
          )}
        </div>
        {line ? <p className={styles.line}>{line}</p> : null}
      </div>
    </div>
  );
}
