import type { Delta } from "./types";
import styles from "./results.module.css";

const KIND_CLASS = { pos: styles.deltaPos, neg: styles.deltaNeg, flat: styles.deltaFlat } as const;

/** The one delta treatment. The wire `text` already carries the glyph (↑/↓/—);
 *  we add weight + amber depth (pos) or muted ink (neg/flat) via CSS only. Never green/red. */
export function DeltaBadge({ delta, size = "sm" }: { delta: Delta | null; size?: "sm" | "lg" }) {
  if (!delta) return null;
  return (
    <span
      data-kind={delta.kind}
      className={`${styles.delta} ${KIND_CLASS[delta.kind]} ${size === "lg" ? styles.deltaLg : ""}`}
    >
      {delta.text}
    </span>
  );
}
