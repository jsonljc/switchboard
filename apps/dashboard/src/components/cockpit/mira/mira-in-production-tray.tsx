"use client";

import type { MiraDeskItem } from "@switchboard/core";
import { STAGE_COPY, PROBLEM_COPY, DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";

// Calm, muted tray (NOT the hero). Plain stage copy by default; a problem
// message only when something is wrong. No engineering-console detail.
export function MiraInProductionTray({ items }: { items: MiraDeskItem[] }) {
  return (
    <section
      aria-label={DESK_COPY.inProductionTitle}
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: 16,
        border: `1px solid ${MIRA_ACCENT.soft}`,
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#666" }}>
        {DESK_COPY.inProductionTitle}
      </h2>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#666" }}>{DESK_COPY.inProductionEmpty}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {items.map((it) => (
            <li
              key={it.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "#333",
              }}
            >
              <span>{it.title}</span>
              <span style={{ color: it.problem ? "#7A2E2E" : MIRA_ACCENT.base }}>
                {it.problem ? PROBLEM_COPY[it.problem] : STAGE_COPY[it.stage]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
