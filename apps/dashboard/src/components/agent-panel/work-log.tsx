"use client";

import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";
import { composeActivityVoice } from "./lib/activity-voice";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { relativeTime } from "./lib/format";
import styles from "./agent-panel.module.css";

const MAX_ROWS = 5;

export interface WorkLogProps {
  agentKey: Exclude<PanelAgentKey, "mira">;
  /**
   * Called when the user taps "See all in Results →".
   * Host wires navigation to the Results route; the panel itself is read-only.
   */
  onSeeAll?: () => void;
}

/**
 * Slot ④: Recent work log — shows the agent's last N actions as first-person
 * sentences, hard-capped at MAX_ROWS (5). Each row is composed via
 * composeActivityVoice(row).
 *
 * States (three-states invariant: loading / error / data):
 *   loading  → skeleton (never flash error/empty during load)
 *   error    → "Couldn't load recent work" (never "0/nothing")
 *   empty    → "No actions in the last 24 hours"
 *   has rows → up to 5 rows + "See all in Results →" footer
 *
 * Header framing: "{Name} handled {N} things recently" — honest phrasing
 * keyed to what the wire provides (count of rows shown). We do NOT fabricate
 * a "since this morning" / "since you last looked" time anchor because the
 * wire provides no last-viewed timestamp.
 *
 * ActivityRow.head is pre-formatted text (prose from the backend translator).
 * It does NOT carry raw cents. No ÷100 is applied here.
 */
export function WorkLog({ agentKey, onSeeAll }: WorkLogProps) {
  const activity = useAgentActivityCockpit(agentKey, { limit: MAX_ROWS });
  const display = agentDisplay[agentKey];

  // ── Loading ──────────────────────────────────────────────────────────────────
  // Guard: on cold mount (data undefined, isError false) the hook is still
  // fetching. Show skeleton to honour the three-states-never-collapse invariant.
  if (activity.isLoading) {
    return (
      <div className={styles.logSection} data-kind="loading" aria-busy="true">
        <div className={styles.logSkeleton} />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  // Never "0" or "no actions" — we genuinely don't know.
  if (activity.isError || !activity.data) {
    return (
      <div className={styles.logSection}>
        <p className={`${styles.logEmptyLine} ${styles.logEmptyErr}`}>
          {"Couldn't load recent work"}
        </p>
      </div>
    );
  }

  const { rows } = activity.data;
  const cappedRows = rows.slice(0, MAX_ROWS);

  // ── Empty ────────────────────────────────────────────────────────────────────
  if (cappedRows.length === 0) {
    return (
      <div className={styles.logSection}>
        <p className={styles.logEmptyLine}>{"No actions in the last 24 hours"}</p>
      </div>
    );
  }

  // ── Has rows ─────────────────────────────────────────────────────────────────
  // Honest header: "{Name} handled {N} things recently"
  // The wire provides no last-viewed timestamp, so we cannot say "since this
  // morning" or "since you last looked". We key the header to the count of rows
  // actually shown — factual, warm, no invented time anchor.
  const n = cappedRows.length;
  const headerText =
    n === 1
      ? `${display.name} handled 1 thing recently`
      : `${display.name} handled ${n} things recently`;
  const nowMs = Date.now();

  return (
    <div className={styles.logSection}>
      {/* Section header */}
      <div className={styles.logSectionH}>
        <span className={styles.logSectionTitle}>{headerText}</span>
      </div>

      {/* Row list */}
      <div className={styles.apLog} role="list" aria-label="Recent activity">
        {cappedRows.map((row, i) => {
          const voice = composeActivityVoice(row);
          // relativeTime uses the ISO timestamp from the row if available, else falls back to the
          // formatted time string (which the translator may render as "14:32" or "Mon").
          // We prefer timestampIso for accurate relative calculation.
          const timeLabel = relativeTime(row.timestampIso ?? null, nowMs) ?? row.time;
          return (
            <div key={row.id ?? i} className={styles.apLogRow} role="listitem">
              <span className={styles.apLogText}>{voice}</span>
              <span className={styles.apLogTime}>{timeLabel}</span>
            </div>
          );
        })}
      </div>

      {/* Footer: "See all in Results →" — quiet route-out affordance */}
      <div className={styles.apLogFoot}>
        <button
          type="button"
          className={styles.apLogFootLink}
          onClick={onSeeAll}
          aria-label="See all activity in Results"
        >
          See all in Results →
        </button>
      </div>
    </div>
  );
}
