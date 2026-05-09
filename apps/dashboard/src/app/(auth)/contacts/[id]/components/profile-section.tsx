import type { ContactDetailProfile } from "@switchboard/schemas";
import styles from "../contact-detail.module.css";
import { formatConsent, relativeAge } from "./format";

function sourceLine(p: ContactDetailProfile): string {
  if (!p.source) return "—";
  if (p.attributionSummary) return `${p.source} · ${p.attributionSummary}`;
  return p.source;
}

export function ProfileSection({ profile }: { profile: ContactDetailProfile }) {
  const rows: Array<[string, string]> = [
    ["Phone", profile.phone ?? "—"],
    ["Email", profile.email ?? "—"],
    ["Source", sourceLine(profile)],
    ["Messaging", formatConsent(profile.messagingConsent)],
    ["Last activity", relativeAge(profile.lastActivityAt)],
    ["First contact", relativeAge(profile.firstContactAt)],
  ];
  return (
    <section className={styles.section}>
      <p className="section-label">Profile</p>
      <dl className={styles.profileGrid}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt className={styles.profileLabel}>{label}</dt>
            <dd className={styles.profileValue}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
