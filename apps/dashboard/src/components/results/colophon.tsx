import styles from "./results.module.css";

/** Footer colophon for the Results screen.
 *  Displays the reporting period, generated timestamp, a live/sample badge,
 *  and the attribution caveat (booked ≠ collected). */
export function Colophon({
  period,
  label,
  isLive,
  generatedAt,
}: {
  period: string;
  label: string;
  isLive: boolean;
  generatedAt: Date;
}) {
  const formattedAt = generatedAt.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <footer className={styles.colophon}>
      <div className={styles.colophonTop}>
        <span className={styles.colophonPeriod}>
          {period} &middot; {label.toLowerCase()}
        </span>
        <span className={styles.colophonBadge} data-live={isLive}>
          {isLive ? "Live data" : "Sample data"}
        </span>
      </div>
      <p className={styles.colophonTimestamp}>Generated {formattedAt}</p>
      <p className={styles.colophonCaveat}>
        Revenue is attributed at the time a consult is booked, not collected; actual collections may
        differ.
      </p>
    </footer>
  );
}
