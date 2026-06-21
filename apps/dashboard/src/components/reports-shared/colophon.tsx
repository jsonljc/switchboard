import styles from "./colophon.module.css";

/**
 * Shared Colophon footer — consumed by both /reports and /results.
 *
 * Props are a superset of both surfaces:
 * - /reports shape: { period, org, liveMode, generatedAt } (via adapter that maps liveMode->isLive)
 * - /results shape: { period, label, isLive, generatedAt }
 *
 * Reconciled caveat covers both surfaces:
 *   - Attribution-window point (/reports): 30-day window, lead source resolution
 *   - Booked-not-collected point (/results): revenue recognised at booking, not collected
 */
export interface ColophonProps {
  period: string;
  /** Org name, shown when provided (/reports call site). */
  org?: string;
  /** Period label (e.g. "THIS MONTH"), lowercased when shown (/results call site). */
  label?: string;
  /** Live vs. sample data indicator. */
  isLive?: boolean;
  generatedAt: Date;
}

export function Colophon({ period, org, label, isLive = false, generatedAt }: ColophonProps) {
  const formattedAt = generatedAt.toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <footer className={styles.colophon}>
      <div className={styles.colophonTop}>
        <span className={styles.colophonPeriod}>
          {period}
          {label ? ` · ${label.toLowerCase()}` : ""}
        </span>
        <span className={styles.colophonBadge} data-live={isLive}>
          {isLive ? "Live data" : "Sample data"}
        </span>
      </div>

      <p className={styles.colophonTimestamp}>
        generated <b>{formattedAt}</b>
        {org && (
          <>
            {" "}
            org · <b>{org}</b>
          </>
        )}
      </p>

      <p className={styles.colophonCaveat}>
        Attributed pipeline reflects bookings whose lead source resolved to a Switchboard-managed
        channel within the 30-day attribution window. Revenue is recognised at the time a consult is
        booked, not collected; actual collections may differ. Cost comparisons are illustrative,
        based on Singapore-market median salary plus typical retainer.
      </p>
    </footer>
  );
}
