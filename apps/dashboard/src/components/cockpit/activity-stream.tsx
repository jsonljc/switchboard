// apps/dashboard/src/components/cockpit/activity-stream.tsx
"use client";

import { useState, useCallback } from "react";
import { T } from "./tokens";
import { ActivityRow as ActivityRowComponent } from "./activity-row";
import type { ActivityRow } from "./types";

export type ActivityFilter = "all" | "booked" | "escalations";

export interface ActivityStreamProps {
  rows: ActivityRow[];
  filter: ActivityFilter;
  setFilter: (f: ActivityFilter) => void;
  compact?: boolean;
}

const FILTERS: ActivityFilter[] = ["all", "booked", "escalations"];

function matchesFilter(row: ActivityRow, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "booked") return row.kind === "booked";
  if (filter === "escalations") return row.kind === "escalated" || row.kind === "waiting";
  return true;
}

function rowKey(row: ActivityRow, index: number): string {
  return row.id ?? `${row.time}-${row.head}-${index}`;
}

export function ActivityStream({ rows, filter, setFilter, compact = false }: ActivityStreamProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filtered = rows.filter((r) => matchesFilter(r, filter));
  return (
    <section
      data-testid="cockpit-activity-stream"
      style={{ padding: compact ? "16px 18px 28px" : "20px 28px 28px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: T.ink3,
            textTransform: "uppercase",
          }}
        >
          Activity
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 11.5,
                color: filter === k ? T.ink : T.ink3,
                fontWeight: filter === k ? 600 : 500,
                padding: "4px 8px",
                borderRadius: 4,
                textTransform: "capitalize",
                fontFamily: "inherit",
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {filtered.map((row, i) => {
          const key = rowKey(row, i);
          return (
            <ActivityRowComponent
              key={key}
              item={row}
              open={open.has(key)}
              toggle={() => toggle(key)}
              compact={compact}
            />
          );
        })}
        {filtered.length === 0 && (
          <li
            style={{
              padding: "20px 0",
              fontSize: 13,
              color: T.ink4,
              fontFamily: "JetBrains Mono",
              letterSpacing: "0.02em",
            }}
          >
            Nothing here yet.
          </li>
        )}
      </ul>
    </section>
  );
}
