import styles from "../reports.module.css";

export function NoConnectionBanner() {
  return (
    <div className={styles.bannerNoconn}>
      <span className={styles.eyebrow}>no meta ads connection</span>
      <span className={styles.msg}>
        Campaigns and funnel will read zero until a Meta Ads connection is reattached. Stripe and
        booking data continue to feed the attribution number above.
      </span>
      <a className={styles.cta} href="/settings/channels">
        Connect under Settings
      </a>
    </div>
  );
}
