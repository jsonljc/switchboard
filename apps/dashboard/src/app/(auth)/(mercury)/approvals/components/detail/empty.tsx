import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";

export function DetailEmpty() {
  return (
    <div className={detailStyles.detailEmpty}>
      <span className={styles.eyebrow}>select an approval</span>
      <p className={detailStyles.detailEmptyLead}>
        Pick a card on the left to see the details and sign.
      </p>
      <p className={detailStyles.detailEmptySub}>
        Each confirmation code locks in a specific set of details. Approving signs only that exact
        version.
      </p>
    </div>
  );
}
