import styles from "../reports.module.css";

/**
 * Honest-disclosure note that the rendered numbers are illustrative.
 * Mercury-register treatment (mono, uppercase, muted) so it reads as
 * a colophon rather than a banner.
 */
export function Disclosure() {
  return (
    <p className={styles.disclosure}>
      Numbers shown are illustrative fixtures. Live attribution wiring lands in a follow-up PR.
    </p>
  );
}
