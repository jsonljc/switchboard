import type { FunnelRowData, FunnelNarrative } from "@switchboard/schemas";
import { fmtInt } from "./format";
import { DeltaBadge } from "./delta-badge";
import styles from "./funnel.module.css";
import voiceStyles from "./mercury-voice.module.css";

/**
 * Shared Funnel widget — consumed by both /reports and /results.
 * Uses semantic <ol><li> structure with DeltaBadge. Mercury-voiced via
 * funnel.module.css (governed: mono 400/500/600 only, no italic).
 */
export function Funnel({ rows, narrative }: { rows: FunnelRowData[]; narrative: FunnelNarrative }) {
  const max = Math.max(...rows.map((r) => r.n), 1);

  return (
    <section className={styles.funnelSection}>
      <div className={styles.funnelHead}>
        <span className={voiceStyles.eyebrow}>Funnel</span>
        <span className={styles.funnelCaption}>five stages · proportional</span>
      </div>

      <ol className={styles.funnelRows}>
        {rows.map((row) => {
          const pct = row.n / max;
          const isEmpty = row.n === 0;

          return (
            <li key={row.stage} className={styles.funnelRow}>
              <span className={styles.funnelStage}>{row.stage}</span>

              <div className={styles.funnelBarTrack}>
                <div
                  className={styles.funnelBar}
                  style={{ width: `${pct * 100}%` }}
                  data-empty={isEmpty || undefined}
                />
              </div>

              <span className={styles.funnelN}>{fmtInt(row.n)}</span>

              <DeltaBadge delta={row.delta} />

              <span className={styles.funnelLabel}>{row.label}</span>
            </li>
          );
        })}
      </ol>

      <p className={styles.funnelNarrative}>
        <span className={styles.funnelNarrativeMarker}>{narrative.marker}</span>
        {" · "}
        {narrative.text}
      </p>
    </section>
  );
}
