import type { Delta } from "@switchboard/schemas";
import styles from "./delta-badge.module.css";

/** Shared delta badge — amber (pos), muted ink (neg/flat). */
export function DeltaBadge({ delta }: { delta: Delta | null }) {
  if (!delta) return null;
  return (
    <span
      className={`${styles.delta} ${delta.kind === "pos" ? styles.deltaPos : delta.kind === "neg" ? styles.deltaNeg : styles.deltaFlat}`}
      data-kind={delta.kind}
    >
      {delta.text}
    </span>
  );
}
