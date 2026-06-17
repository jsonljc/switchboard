"use client";

import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";
import { QueryStates } from "@/components/query-states";
import { composeActivityVoice } from "./lib/activity-voice";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { relativeTime } from "./lib/format";
import styles from "./agent-panel.module.css";

const MAX_ROWS = 5;

export interface WorkLogProps {
  // Accepts any PanelAgentKey (mira no longer type-fenced out). The AgentPanel
  // routes mira to its own desk-fed work-log in MiraPanel; the alex/riley hosts
  // pass alex/riley here. The activity-cockpit hook is keyed by AgentKey.
  agentKey: PanelAgentKey;
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

  // Route the loading/error/empty/data quad through <QueryStates>, which derives
  // state from {data, error} only. useAgentActivityCockpit is `enabled: !!keys`,
  // so during keys-pending isLoading is false; a plain `if (isLoading)` gate is
  // skipped and falls through to a false "Couldn't load recent work". The
  // {data, error} rule treats keys-pending as loading.
  return (
    <QueryStates
      query={activity}
      isEmpty={(d) => d.rows.length === 0}
      loading={
        <div className={styles.logSection} data-kind="loading" aria-busy="true">
          <div className={styles.logSkeleton} />
        </div>
      }
      error={
        <div className={styles.logSection}>
          <p className={`${styles.logEmptyLine} ${styles.logEmptyErr}`}>
            {"Couldn't load recent work"}
          </p>
        </div>
      }
      empty={
        <div className={styles.logSection}>
          <p className={styles.logEmptyLine}>{"No actions in the last 24 hours"}</p>
        </div>
      }
    >
      {({ rows }) => {
        const cappedRows = rows.slice(0, MAX_ROWS);
        // Honest header keyed to the count of rows actually shown; the wire
        // provides no last-viewed timestamp, so we never invent a time anchor.
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
                // relativeTime prefers timestampIso for accurate relative calc, else
                // falls back to the formatted time string ("14:32" or "Mon").
                const timeLabel = relativeTime(row.timestampIso ?? null, nowMs) ?? row.time;
                return (
                  <div key={row.id ?? i} className={styles.apLogRow} role="listitem">
                    <span className={styles.apLogText}>{voice}</span>
                    <span className={styles.apLogTime}>{timeLabel}</span>
                  </div>
                );
              })}
            </div>

            {/* Footer: "See all in Results" quiet route-out affordance */}
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
      }}
    </QueryStates>
  );
}
