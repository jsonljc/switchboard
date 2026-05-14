import styles from "../../approvals.module.css";

export function DetailEmpty() {
  return (
    <div className={styles.detailEmpty}>
      <span className={styles.eyebrow}>select an approval</span>
      <p className={styles.detailEmptyLead}>Pick a card on the left to see the details and sign.</p>
      <p className={styles.detailEmptySub}>
        Each confirmation code locks in a specific set of details. Approving signs only that exact
        version.
      </p>
    </div>
  );
}
