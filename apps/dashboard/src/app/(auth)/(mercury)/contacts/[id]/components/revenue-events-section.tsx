import type { ContactDetailRevenueEvent } from "@switchboard/schemas";
import styles from "../contact-detail.module.css";
import { formatMoney, relativeAge, stageLabel } from "./format";

export function RevenueEventsSection({ items }: { items: ContactDetailRevenueEvent[] }) {
  return (
    <section className={styles.section}>
      <p className="section-label">Revenue events</p>
      {items.length === 0 ? (
        <p className={styles.empty}>No revenue events yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col" className={styles.numCell}>
                Amount
              </th>
              <th scope="col">Status</th>
              <th scope="col">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ev) => (
              <tr key={ev.id}>
                <td>{stageLabel(ev.type)}</td>
                <td className={styles.numCell}>{formatMoney(ev.amount, ev.currency)}</td>
                <td>{stageLabel(ev.status)}</td>
                <td>{relativeAge(ev.recordedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
