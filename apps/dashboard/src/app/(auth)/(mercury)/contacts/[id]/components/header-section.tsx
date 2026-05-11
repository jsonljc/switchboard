import type { ContactDetailProfile } from "@switchboard/schemas";
import styles from "../contact-detail.module.css";
import { channelLabel, relativeAge, stageLabel } from "./format";

export function HeaderSection({ profile }: { profile: ContactDetailProfile }) {
  return (
    <header className={styles.headerSection}>
      <p className="section-label">Contact</p>
      <h1 className={styles.displayName}>{profile.displayName}</h1>
      <p className={styles.headerMeta}>
        <span>{channelLabel(profile.primaryChannel)}</span>
        <span className={styles.dot} aria-hidden="true" />
        <span>{stageLabel(profile.stage)}</span>
        <span className={styles.dot} aria-hidden="true" />
        <span>Last seen {relativeAge(profile.lastActivityAt)}</span>
      </p>
    </header>
  );
}
