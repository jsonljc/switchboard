"use client";

import Link from "next/link";
import { DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { T } from "@/components/cockpit/tokens";

export function MiraReadyToReview({ count }: { count: number }) {
  return (
    <section
      aria-label={DESK_COPY.readyTitle}
      style={{
        background: T.paper,
        borderRadius: 8,
        padding: 18,
        border: `1px solid ${T.hair}`,
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
            color: T.ink,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            {count} draft{count === 1 ? "" : "s"} ready to review
          </span>
          <span aria-hidden="true" style={{ color: T.amber, fontWeight: 700 }}>
            →
          </span>
        </Link>
      ) : (
        <p style={{ margin: 0, color: T.ink3, fontSize: 14 }}>{DESK_COPY.readyEmptyBody}</p>
      )}
    </section>
  );
}
