"use client";

import { fmtSGD } from "@/components/reports-shared/format";
import type { PaidVisitRow } from "@switchboard/schemas";
import styles from "./results.module.css";

export function PaidVisitsSection({ visits }: { visits: PaidVisitRow[] }) {
  if (visits.length === 0) {
    return (
      <p className={styles.campaignEmpty}>
        No paid visits yet — once a deposit is captured against a booking, the verified visit and
        the ad that produced it appear here.
      </p>
    );
  }

  return (
    <ol className={styles.campaignCardList}>
      {visits.map((v) => (
        <li key={v.bookingId} className={styles.campaignCard}>
          {v.attributionBasis === "ctwa_captured" && v.campaignName ? (
            <span>
              Paid {fmtSGD(v.amountMajor, { withCents: "always" })} visit linked to campaign{" "}
              {v.campaignName} via CTWA attribution
            </span>
          ) : (
            <span>
              Paid {fmtSGD(v.amountMajor, { withCents: "always" })} visit — campaign not captured
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
