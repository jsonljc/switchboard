import type { ContactDetailOpenDecision } from "@switchboard/schemas";
import styles from "../contact-detail.module.css";
import { relativeAge } from "./format";

const KIND_BADGE: Record<ContactDetailOpenDecision["kind"], string> = {
  approval: "rec",
  handoff: "hand",
};

export function OpenDecisionsSection({ items }: { items: ContactDetailOpenDecision[] }) {
  return (
    <section className={styles.section}>
      <p className="section-label">Open decisions</p>
      {items.length === 0 ? (
        <p className={styles.empty}>No open decisions for this contact.</p>
      ) : (
        <ul className={styles.decisionList}>
          {items.map((d) => (
            <li key={d.id} className={styles.decisionRow}>
              <span className={styles.decisionKind}>{KIND_BADGE[d.kind]}</span>
              <span className={styles.decisionTitle}>{d.title}</span>
              <span className={styles.decisionAgent}>{d.agentKey ?? "—"}</span>
              <span className={styles.decisionTime}>{relativeAge(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
