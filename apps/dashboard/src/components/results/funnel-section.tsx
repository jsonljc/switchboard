import { fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import type { FunnelRowData, FunnelNarrative } from "./types";
import { DeltaBadge } from "./delta-badge";
import styles from "./results.module.css";

/**
 * Custom bar-chart funnel — NO chart library. Plain divs with proportional
 * widths. Stage strings are rendered straight from the wire; we never
 * hardcode a stage list.
 */
export function FunnelSection({
  funnel,
  narrative,
}: {
  funnel: FunnelRowData[];
  narrative: FunnelNarrative;
}) {
  const max = Math.max(...funnel.map((f) => f.n), 1);

  return (
    <section className={styles.funnelSection}>
      <ol className={styles.funnelRows}>
        {funnel.map((row) => {
          const pct = row.n / max;
          const isEmpty = row.n === 0;

          return (
            <li key={row.stage} className={styles.funnelRow}>
              {/* Stage label — straight from wire */}
              <span className={styles.funnelStage}>{row.stage}</span>

              {/* Bar track */}
              <div className={styles.funnelBarTrack}>
                <div
                  className={styles.funnelBar}
                  style={{ width: `${pct * 100}%` }}
                  data-empty={isEmpty || undefined}
                />
              </div>

              {/* Number — mono tabular */}
              <span className={styles.funnelN}>{fmtInt(row.n)}</span>

              {/* Delta badge */}
              <DeltaBadge delta={row.delta} />

              {/* Wire label (formatted string) — mono */}
              <span className={styles.funnelLabel}>{row.label}</span>
            </li>
          );
        })}
      </ol>

      {/* Narrative footer — editorial byline */}
      <p className={styles.funnelNarrative}>
        <span className={styles.funnelNarrativeMarker}>{narrative.marker}</span>
        {" · "}
        {narrative.text}
      </p>
    </section>
  );
}
