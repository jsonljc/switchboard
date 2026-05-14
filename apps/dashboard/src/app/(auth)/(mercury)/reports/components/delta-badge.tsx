import type { Delta } from "@switchboard/schemas";
import styles from "../reports.module.css";

export function DeltaBadge({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  const arrow = delta.kind === "pos" ? "↑" : delta.kind === "neg" ? "↓" : "—";
  const cleaned = delta.text.replace(/^[↑↓—]\s*/, "");
  return (
    <span className={`${styles.deltaBadge} ${styles[delta.kind]}`}>
      <span className={styles.arrow}>{arrow}</span>
      <span>{cleaned}</span>
    </span>
  );
}
