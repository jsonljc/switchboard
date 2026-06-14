"use client";

import { useRecordAttendance } from "@/hooks/use-record-attendance";
import styles from "./attendance-check-in.module.css";

/**
 * Fire-only control to mark a booking attended or no_show.
 * No pre-fill: the wins feed does not expose current attendance state (fire-only).
 */
export function AttendanceCheckIn({ bookingId }: { bookingId: string }) {
  const { mutate, isPending } = useRecordAttendance();

  return (
    <div className={styles.root} data-testid="attendance-check-in">
      <button
        type="button"
        className={`${styles.btn} ${styles.btnAttended}`}
        disabled={isPending}
        onClick={() => mutate({ bookingId, outcome: "attended" })}
      >
        {"Attended"}
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnNoShow}`}
        disabled={isPending}
        onClick={() => mutate({ bookingId, outcome: "no_show" })}
      >
        {"No-show"}
      </button>
    </div>
  );
}
