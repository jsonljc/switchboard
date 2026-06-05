"use client";

import Link from "next/link";
import type { MiraDeskItem } from "@switchboard/core";
import {
  STAGE_COPY,
  UGC_PHASE_COPY,
  AWAITING_GO_COPY,
  PROBLEM_COPY,
  DESK_COPY,
} from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";
import styles from "./mira-desk.module.css";

// Mode-honest progress label: ugc reads its phase (the polished stage column
// is frozen for ugc jobs); a pre-video approval gate beats both.
function itemStatusCopy(it: MiraDeskItem): string {
  if (it.problem) return PROBLEM_COPY[it.problem];
  if (it.awaitingGo) return AWAITING_GO_COPY;
  if (it.ugcPhase) return UGC_PHASE_COPY[it.ugcPhase] ?? it.ugcPhase;
  return STAGE_COPY[it.stage];
}

// Calm, muted tray (NOT the hero). Plain stage copy by default; a problem
// message only when something is wrong. No engineering-console detail.
export function MiraInProductionTray({ items }: { items: MiraDeskItem[] }) {
  return (
    <section aria-label={DESK_COPY.inProductionTitle} className={styles.card}>
      <h2 className={styles.moduleH}>{DESK_COPY.inProductionTitle}</h2>
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
              {/* The detail page is where Continue/Stop lives; pre-video
                  gates have no feed card, so this link IS the operator's
                  path to them (slice-3 spec 3.4). */}
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
                  color: it.problem ? T.red : MIRA_ACCENT.base,
                }}
              >
                {itemStatusCopy(it)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
