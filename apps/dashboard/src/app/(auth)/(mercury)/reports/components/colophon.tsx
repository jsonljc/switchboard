import styles from "../reports.module.css";

export interface ColophonProps {
  period: string;
  org: string;
  generatedAt: Date;
  liveMode: boolean;
}

export function Colophon({ period, org, generatedAt, liveMode }: ColophonProps) {
  return (
    <footer className={styles.colophon}>
      <div className={styles.left}>
        <span className={styles.eyebrow}>Colophon</span>
        <span className={styles.period}>{period}</span>
        <span className={styles.caveat}>
          Attributed pipeline reflects bookings whose lead source resolved to a Switchboard-managed
          channel within the 30-day attribution window. Revenue is recognised at the point of
          booking, not the point of service. Cost comparisons are illustrative, based on
          Singapore-market median salary plus typical retainer.
        </span>
      </div>
      <div className={styles.right}>
        <span className={`${styles.mode} ${liveMode ? styles.live : ""}`}>
          <span className={styles.dot} /> {liveMode ? "Live data" : "Sample data"}
        </span>
        <span>
          generated{" "}
          <b>{generatedAt.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</b>
        </span>
        <span>
          org · <b>{org}</b>
        </span>
      </div>
    </footer>
  );
}
