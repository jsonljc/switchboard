"use client";

import type { ActorType } from "@switchboard/schemas";
import styles from "../activity.module.css";

export type { ActorType };

export interface ActorPillsProps {
  /** Active actor type filter (null = no selection). */
  value: ActorType | null;
  /** Page-local counts keyed by actor type. */
  counts: Record<ActorType, number>;
  /** Mutual exclusion: click active to deselect (null). */
  onChange: (next: ActorType | null) => void;
}

const ORDER: ReadonlyArray<{ key: ActorType; label: string }> = [
  { key: "user", label: "User" },
  { key: "agent", label: "Agent" },
  { key: "system", label: "System" },
  { key: "service_account", label: "Service" },
];

/**
 * Four mutually-exclusive actor-type pills + helper line.
 *
 * Spec §5.2: each pill carries `· N on this page` suffix; the muted helper
 * line below sets expectation that specific-actor filtering (e.g. just Alex)
 * is unavailable — see spec §1.2 for the actorId-filter gap.
 */
export function ActorPills({ value, counts, onChange }: ActorPillsProps) {
  return (
    <>
      <span className={styles.filterStripEyebrow}>actor</span>
      <div className={styles.actorGroup} role="group" aria-label="Actor type">
        {ORDER.map(({ key, label }) => {
          const active = value === key;
          return (
            <button
              type="button"
              key={key}
              className={active ? `${styles.actorPill} ${styles.actorPillOn}` : styles.actorPill}
              aria-pressed={active}
              onClick={() => onChange(active ? null : key)}
            >
              {label}
              <span className={styles.actorPillCount}>{counts[key] ?? 0}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.actorHelper}>
        Specific actor filtering (e.g. just Alex) is not yet available — see §1.2.
      </p>
    </>
  );
}
