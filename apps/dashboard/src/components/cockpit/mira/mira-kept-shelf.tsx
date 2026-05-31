"use client";

import type { MiraDeskItem } from "@switchboard/core";
import { useReviewDecision } from "@/hooks/use-review-decision";
import { DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";

// Quietest module. Read-mostly: each kept draft has a subtle un-keep (reversible).
// `handoff_unavailable` is conveyed ONLY by the neutral sub-copy — never a red chip.
export function MiraKeptShelf({ items }: { items: MiraDeskItem[] }) {
  const decide = useReviewDecision();
  return (
    <section
      aria-label={DESK_COPY.keptTitle}
      style={{
        background: "transparent",
        borderRadius: 14,
        padding: 16,
        border: `1px solid ${MIRA_ACCENT.soft}`,
      }}
    >
      <h2 style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#666" }}>
        {DESK_COPY.keptTitle}
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "#888" }}>{DESK_COPY.keptSub}</p>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#888" }}>{DESK_COPY.keptEmpty}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            gap: 10,
            overflowX: "auto",
          }}
        >
          {items.map((it) => (
            <li key={it.id} style={{ flex: "0 0 auto", width: 96 }}>
              {it.thumbnailUrl ? (
                <img
                  src={it.thumbnailUrl}
                  alt={it.title}
                  width={96}
                  height={128}
                  style={{ borderRadius: 8, objectFit: "cover", background: MIRA_ACCENT.soft }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{ width: 96, height: 128, borderRadius: 8, background: MIRA_ACCENT.soft }}
                />
              )}
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 11,
                  color: "#444",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.title}
              </span>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: it.id, decision: null }, {})}
                style={{
                  marginTop: 2,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: MIRA_ACCENT.base,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Un-keep
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
