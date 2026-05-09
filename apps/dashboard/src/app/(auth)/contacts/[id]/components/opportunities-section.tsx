import type { ContactDetailOpportunity } from "@switchboard/schemas";
import styles from "../contact-detail.module.css";
import { formatMoney, relativeAge, stageLabel } from "./format";

export function OpportunitiesSection({ items }: { items: ContactDetailOpportunity[] }) {
  return (
    <section className={styles.section}>
      <p className="section-label">Opportunities</p>
      {items.length === 0 ? (
        <p className={styles.empty}>No opportunities yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Stage</th>
              <th scope="col" className={styles.numCell}>
                Value
              </th>
              <th scope="col">Opened</th>
              <th scope="col">Closed</th>
            </tr>
          </thead>
          <tbody>
            {items.map((opp) => (
              <tr key={opp.id}>
                <td>{opp.serviceName}</td>
                <td>{stageLabel(opp.stage)}</td>
                <td className={styles.numCell}>{formatMoney(opp.estimatedValue)}</td>
                <td>{relativeAge(opp.openedAt)}</td>
                <td>{opp.closedAt ? relativeAge(opp.closedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
