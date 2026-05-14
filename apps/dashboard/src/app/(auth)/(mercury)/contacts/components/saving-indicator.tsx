import styles from "../pipeline.module.css";

export function SavingIndicator({ saving }: { saving: boolean }) {
  return (
    <div className={styles.savingIndicator} data-state={saving ? "saving" : "synced"}>
      <span className={styles.eyebrow}>state</span>
      <div className={styles.savingValue} data-tabular>
        {saving ? (
          <>
            saving
            <span className={styles.savedot} aria-hidden="true" />
            <span className={styles.savedot} aria-hidden="true" />
            <span className={styles.savedot} aria-hidden="true" />
          </>
        ) : (
          <>
            <span className={styles.syncedDot} aria-hidden="true" />
            synced
          </>
        )}
      </div>
    </div>
  );
}
