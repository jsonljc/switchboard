import { isMercuryToolLive } from "@/lib/route-availability";
import styles from "./fixture-mode-banner.module.css";

/**
 * Visible label shown on /reports when reports is not in live mode.
 *
 * Local-readiness requirement: /reports stays in fixture mode locally
 * (no Meta Ads Connection provider yet). Without this banner, the page
 * looks indistinguishable from real reporting data — exactly the failure
 * mode the local-readiness spec exists to eliminate.
 *
 * See docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md §1.4.
 */
export function FixtureModeBanner() {
  if (isMercuryToolLive("reports")) return null;
  return (
    <div role="status" className={styles.banner}>
      <span className={styles.chip}>Demo data</span>
      <span className={styles.text}>
        Not connected to a live ads account. Numbers shown are illustrative fixtures.
      </span>
    </div>
  );
}
