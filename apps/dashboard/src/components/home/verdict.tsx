import type { CSSProperties } from "react";
import type { VerdictModel } from "./types";
import styles from "./home.module.css";

interface VerdictProps {
  model: VerdictModel;
}

/**
 * Verdict — the hero greeting + one honest verdict sentence at the top of Home.
 *
 * Presentational only: receives a pre-composed VerdictModel, never fetches.
 * No links, buttons, or navigation — just the one sentence that earns the screen.
 */
export function Verdict({ model }: VerdictProps) {
  const { shape, eyebrow, salutation, line, proof, accentAgent } = model;

  // Deep identity ink (the same ink as the team poster names): the base hue
  // fails contrast on the grain canvas (2.4:1 sampled live); the deep ink
  // holds AA for large-scale text on the real ground.
  const accentStyle: CSSProperties | undefined = accentAgent
    ? { color: `hsl(var(--agent-${accentAgent}-deep))` }
    : undefined;

  return (
    <section
      className={`${styles.verdict} ${styles[shape]}`}
      aria-label="verdict"
      data-shape={shape}
    >
      <div className={styles.verdictTop}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <span className={styles.hello}>{salutation}</span>
      </div>
      <h1 className={styles.line}>
        {typeof line === "string" ? (
          line
        ) : (
          <>
            {line.pre}
            <span className={styles.accent} style={accentStyle}>
              {line.em}
            </span>
            {line.post}
          </>
        )}
      </h1>
      <span className={styles.proof}>{proof}</span>
    </section>
  );
}
