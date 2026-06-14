"use client";

import { useAgentWins } from "@/hooks/use-agent-wins";
import { QueryStates } from "@/components/query-states";
import { AttendanceCheckIn } from "./attendance-check-in";
import { formatCents } from "./lib/format";
import styles from "./agent-panel.module.css";

/**
 * Slot: Alex's recent wins — booked consultations surfaced from the F5
 * booking-outcome ledger (trace + revenue). Booking is Alex-exclusive, so the
 * host renders this slot only for Alex.
 *
 * Three-states invariant via <QueryStates> (derives from {data,error}, so
 * keys-pending reads as loading, never a false error — the enabled:false
 * pitfall):
 *   loading → skeleton
 *   error   → "Couldn't load wins"
 *   empty   → "No bookings yet"
 *   data    → up to 5 wins (service · revenue|pending · time · trace)
 *
 * Revenue is null until the ConversionRecord settles → render "revenue
 * pending", never a fabricated number. The trace id is surfaced as provenance
 * (the panel's thesis is provenance over liveness).
 */
export function AlexWins() {
  const wins = useAgentWins("alex");
  return (
    <QueryStates
      query={wins}
      isEmpty={(d) => d.wins.length === 0}
      loading={
        <div className={styles.logSection} data-kind="loading" aria-busy="true">
          <div className={styles.logSkeleton} />
        </div>
      }
      error={
        <div className={styles.logSection}>
          <p className={`${styles.logEmptyLine} ${styles.logEmptyErr}`}>{"Couldn't load wins"}</p>
        </div>
      }
      empty={
        <div className={styles.logSection}>
          <p className={styles.logEmptyLine}>{"No bookings yet"}</p>
        </div>
      }
    >
      {({ wins: rows }) => (
        <div className={styles.logSection} data-testid="alex-wins">
          <div className={styles.logSectionH}>
            <span className={styles.logSectionTitle}>
              {rows.length === 1 ? "1 booking converted" : `${rows.length} bookings converted`}
            </span>
          </div>
          <div className={styles.apLog} role="list" aria-label="Recent wins">
            {rows.map((w) => {
              const revenue = w.revenuePending
                ? "revenue pending"
                : (formatCents(w.valueCents) ?? "revenue pending");
              return (
                <div
                  key={w.traceId}
                  className={styles.apLogRow}
                  role="listitem"
                  data-trace-id={w.traceId}
                >
                  <span className={styles.apLogText}>{`Booked ${w.service} · ${revenue}`}</span>
                  <span className={styles.apLogTime} title={w.traceId}>
                    {`${w.timeFolio} · #${w.traceId.slice(0, 8)}`}
                  </span>
                  <AttendanceCheckIn bookingId={w.bookingId} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </QueryStates>
  );
}
