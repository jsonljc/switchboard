"use client";

import Link from "next/link";
import type { MiraDeskItem } from "@switchboard/core";
import { PROBLEM_COPY, DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { T } from "@/components/cockpit/tokens";
import styles from "./mira-desk.module.css";

// D9-F3 — the attention module. Approved (kept) drafts whose Meta publishing
// dead-lettered are pulled out of the calm kept shelf and surfaced here, at the
// top of the Director's Desk, so a busy operator learns that publishing failed
// without already knowing to open that one creative's detail page. Renders
// nothing in the happy path (no failures in the desk window).
export function MiraNeedsAttention({ items }: { items: MiraDeskItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={DESK_COPY.needsAttentionTitle} className={styles.card}>
      <h2 className={styles.moduleH} style={{ color: T.red }}>
        {DESK_COPY.needsAttentionTitle}
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: T.ink3 }}>
        {DESK_COPY.needsAttentionSub}
      </p>
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
            {/* The detail page carries the full failure notice (#996) and is the
                operator's path to whatever comes next. */}
            <Link
              href={`/mira/creatives/${it.id}`}
              style={{ color: T.ink2, textDecoration: "none" }}
            >
              {it.title}
            </Link>
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 12,
                letterSpacing: "0.02em",
                color: T.red,
              }}
            >
              {it.problem ? PROBLEM_COPY[it.problem] : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
