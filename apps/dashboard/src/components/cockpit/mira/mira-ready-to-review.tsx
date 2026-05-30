"use client";

import Link from "next/link";
import { DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";

export function MiraReadyToReview({ count }: { count: number }) {
  return (
    <section
      aria-label={DESK_COPY.readyTitle}
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: 18,
        border: `2px solid ${MIRA_ACCENT.deep}`,
      }}
    >
      {count > 0 ? (
        <Link
          href="/mira/review"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textDecoration: "none",
            color: MIRA_ACCENT.deep,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            {count} draft{count === 1 ? "" : "s"} ready to review
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <p style={{ margin: 0, color: MIRA_ACCENT.deep, fontSize: 14 }}>
          {DESK_COPY.readyEmptyBody}
        </p>
      )}
    </section>
  );
}
