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
        // The cockpit's one loud element: a KPI/verdict block. Loudness comes
        // from the type scale (big tabular numeral) + the amber CTA, not a border.
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: T.ink3,
            }}
          >
            {DESK_COPY.readyTitle}
          </span>
          <span
            style={{
              marginTop: 4,
              fontFamily: T.mono,
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1,
              color: T.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </span>
          <span style={{ marginTop: 6, fontSize: 14, color: T.ink3 }}>
            {count} draft{count === 1 ? "" : "s"} ready to review
          </span>
          <Link
            href="/mira/review"
            style={{
              marginTop: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 16px",
              borderRadius: 8,
              background: T.amber,
              color: T.actionFg,
              border: `1px solid ${T.amberDeep}`,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Review drafts
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <p style={{ margin: 0, color: T.ink3, fontSize: 14 }}>{DESK_COPY.readyEmptyBody}</p>
      )}
    </section>
  );
}
