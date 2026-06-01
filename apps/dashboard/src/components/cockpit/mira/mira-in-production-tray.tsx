"use client";

import type { MiraDeskItem } from "@switchboard/core";
import { STAGE_COPY, PROBLEM_COPY, DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";

// Calm, muted tray (NOT the hero). Plain stage copy by default; a problem
// message only when something is wrong. No engineering-console detail.
export function MiraInProductionTray({ items }: { items: MiraDeskItem[] }) {
  return (
    <section
      aria-label={DESK_COPY.inProductionTitle}
      style={{
        background: T.paper,
        borderRadius: 8,
        padding: 16,
        border: `1px solid ${T.hair}`,
      }}
    >
      <h2
        style={{
          margin: "0 0 8px",
          fontFamily: "JetBrains Mono",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: T.ink3,
        }}
      >
        {DESK_COPY.inProductionTitle}
      </h2>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: T.ink3 }}>{DESK_COPY.inProductionEmpty}</p>
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
                color: T.ink2,
              }}
            >
              <span>{it.title}</span>
              <span
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  color: it.problem ? T.red : MIRA_ACCENT.base,
                }}
              >
                {it.problem ? PROBLEM_COPY[it.problem] : STAGE_COPY[it.stage]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
