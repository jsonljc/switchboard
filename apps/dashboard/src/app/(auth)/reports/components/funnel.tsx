import type { FunnelNarrative, FunnelRowData } from "../fixtures";
import styles from "../reports.module.css";

interface FunnelRowProps {
  row: FunnelRowData;
  maxN: number;
}

function FunnelRow({ row, maxN }: FunnelRowProps) {
  const ratio = row.n / maxN;
  const W = 100;
  const len = Math.max(2, ratio * W);
  const deltaCls =
    row.delta?.kind === "neg" ? styles.isNeg : row.delta?.kind === "pos" ? styles.isPos : "";
  return (
    <div className={styles.funnelRow}>
      <span className={styles.funnelStage}>{row.stage}</span>
      <span className={styles.funnelNum}>{row.label}</span>
      <span className={styles.funnelBar} aria-hidden="true">
        <svg viewBox={`0 0 ${W} 1`} preserveAspectRatio="none">
          <line x1="0" y1="0.5" x2={len.toFixed(2)} y2="0.5" className={styles.funnelLine} />
        </svg>
      </span>
      <span className={`${styles.funnelDelta} ${deltaCls}`}>{row.delta ? row.delta.text : ""}</span>
    </div>
  );
}

interface FunnelProps {
  data: FunnelRowData[];
  narrative: FunnelNarrative;
  period: string;
}

export function Funnel({ data, narrative, period }: FunnelProps) {
  const maxN = Math.max(...data.map((d) => d.n));
  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>Funnel</span>
        <span className={styles.folioR}>{period}</span>
      </div>
      <div className={styles.funnel}>
        {data.map((r) => (
          <FunnelRow key={r.stage} row={r} maxN={maxN} />
        ))}
      </div>
      <p className={styles.funnelNarrative}>
        <span className={styles.marker}>{narrative.marker}</span>— {narrative.text}
      </p>
    </>
  );
}
