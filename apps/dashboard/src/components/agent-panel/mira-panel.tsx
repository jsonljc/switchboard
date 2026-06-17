"use client";

import { useRouter } from "next/navigation";
import type { MiraDeskItem, MiraDeskModel } from "@switchboard/core";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import { useMiraDesk } from "@/hooks/use-mira-desk";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import { relativeTime } from "./lib/format";
import styles from "./agent-panel.module.css";

const MAX_LOG_ROWS = 5;

/**
 * Enablement-aware Mira drill-in. When Mira is enabled we render the same
 * four-slot composition Alex/Riley expose (KeyResult / IdentityStatus /
 * OpenDecisions / WorkLog), but fed from the Director's Desk read-model
 * (useMiraDesk) rather than the lead-response/ad hooks — Mira has no agentRole,
 * mission, or decision feed, so the desk buckets map onto the slots instead:
 *   ① KeyResult      ← readyToReviewCount (drafts ready to review)
 *   ② IdentityStatus ← inProduction       (work in flight)
 *   ③ OpenDecisions  ← needsAttention      (failed / publish dead-letters)
 *   ④ WorkLog        ← keptDrafts          (recently kept drafts)
 * When Mira is not yet enabled we keep the honest "not set up" body. The
 * letter-disc monogram is retired: PrintedPortraitAvatar is the one frame.
 */
export function MiraPanel() {
  const router = useRouter();
  const { enabled } = useMiraEnabled();
  // Desk read-model only when enabled (the API 404s otherwise).
  const deskQ = useMiraDesk(enabled ?? false);

  if (enabled) {
    const desk = deskQ.data;
    return (
      <>
        {/* ① KeyResult — drafts-ready hero */}
        <MiraKeyResult desk={desk} />
        {/* ② IdentityStatus — in-production presence */}
        <MiraIdentityStatus desk={desk} />
        {/* ③ OpenDecisions — publish dead-letters that need the operator */}
        <MiraOpenDecisions desk={desk} onOpen={() => router.push("/mira")} />
        {/* ④ WorkLog — recently kept drafts */}
        <MiraWorkLog desk={desk} />
        <div className={styles.miraOpenCtaRow}>
          <button type="button" className={styles.miraOpenCta} onClick={() => router.push("/mira")}>
            Open Mira&apos;s workspace &rarr;
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={styles.notset}>
      <PrintedPortraitAvatar agentKey="mira" size={84} hero showPip={false} />
      <h3 className={styles.notsetHeading}>Mira isn&apos;t set up yet</h3>
      <p className={styles.notsetSub}>
        Mira handles creative and content. She becomes available as your workspace grows.
      </p>
      <span className={styles.notsetMeta}>Coming soon</span>
    </div>
  );
}

/**
 * Slot ① — Key result hero. Mirrors Alex/Riley's heroCard, but the headline
 * figure is the live drafts-ready count. A loading desk shows the shared
 * skeleton; a settled desk always shows the number (zero is honest, not error).
 */
function MiraKeyResult({ desk }: { desk: MiraDeskModel | undefined }) {
  if (!desk) {
    return (
      <div
        className={styles.heroCard}
        data-kind="loading"
        aria-busy="true"
        data-testid="mira-key-result"
      >
        <div className={styles.heroSkeleton} />
      </div>
    );
  }
  const ready = desk.readyToReviewCount ?? 0;
  const isZero = ready === 0;
  return (
    <div
      className={`${styles.heroCard}${isZero ? ` ${styles.heroZero}` : ""}`}
      data-kind="proof"
      data-testid="mira-key-result"
    >
      <p className={styles.heroEyebrow}>ready to review</p>
      <div className={styles.heroValueRow}>
        <span className={`${styles.heroValue}${isZero ? ` ${styles.heroValueZero}` : ""}`}>
          {ready}
        </span>
        <span className={`${styles.heroUnit}${isZero ? ` ${styles.heroValueZero}` : ""}`}>
          {ready === 1 ? "draft" : "drafts"}
        </span>
      </div>
    </div>
  );
}

/**
 * Slot ② — Identity/presence. The forward signal for Mira is how much work is
 * in production right now; the honest empty state is "Nothing in production".
 */
function MiraIdentityStatus({ desk }: { desk: MiraDeskModel | undefined }) {
  const inProduction = desk?.inProduction ?? [];
  const n = inProduction.length;
  return (
    <div className={styles.identityStatus} data-testid="mira-identity-status">
      <div className={styles.statusBlock}>
        {!desk ? (
          <p className={styles.presenceLine}>Checking what&apos;s in production…</p>
        ) : n > 0 ? (
          <>
            <p className={styles.healthLine}>
              {n === 1 ? "1 creative in production" : `${n} creatives in production`}
            </p>
            <p className={styles.presenceLine}>
              {inProduction
                .slice(0, 3)
                .map((item) => item.title)
                .join(" · ")}
            </p>
          </>
        ) : (
          <p className={styles.presenceLine}>Nothing in production right now</p>
        )}
      </div>
    </div>
  );
}

/**
 * Slot ③ — Open decisions. For Mira these are the publish dead-letters
 * (needsAttention) that a retry-exhausted publish surfaces. Each row routes out
 * to the workspace (read-only here, like Alex/Riley). Empty stays calm.
 */
function MiraOpenDecisions({
  desk,
  onOpen,
}: {
  desk: MiraDeskModel | undefined;
  onOpen: () => void;
}) {
  const items = desk?.needsAttention ?? [];
  if (!desk) {
    return (
      <div
        className={styles.decisionSection}
        data-kind="loading"
        aria-busy="true"
        data-testid="mira-open-decisions"
      >
        <div className={styles.decisionSkeleton} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className={styles.decisionSection} data-testid="mira-open-decisions">
        <p className={styles.decisionEmptyLine}>Nothing waiting on you from Mira</p>
      </div>
    );
  }
  return (
    <div className={styles.decisionSection} data-testid="mira-open-decisions">
      <div className={styles.decisionSectionH}>
        <span className={styles.decisionSectionTitle}>Needs you</span>
        <span className={styles.decisionSectionMeta}>{items.length}</span>
      </div>
      <ul className={styles.decisionList} role="list">
        {items.map((item) => (
          <li key={item.id} role="listitem">
            <button
              type="button"
              className={styles.decisionRow}
              onClick={onOpen}
              aria-label={`${item.title} · publish failed`}
            >
              <span className={styles.decisionGist}>{`${item.title} · publish failed`}</span>
              <span className={styles.decisionArrow} aria-hidden="true">
                <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4.5 2.5L8 6L4.5 9.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Slot ④ — Work log. Mira's "recent work" is the kept-draft shelf: drafts the
 * operator has already approved. Hard-capped at MAX_LOG_ROWS, mirroring the
 * Alex/Riley work-log rhythm. Empty stays honest ("No drafts kept recently").
 */
function MiraWorkLog({ desk }: { desk: MiraDeskModel | undefined }) {
  if (!desk) {
    return (
      <div
        className={styles.logSection}
        data-kind="loading"
        aria-busy="true"
        data-testid="mira-work-log"
      >
        <div className={styles.logSkeleton} />
      </div>
    );
  }
  const rows: MiraDeskItem[] = (desk.keptDrafts ?? []).slice(0, MAX_LOG_ROWS);
  if (rows.length === 0) {
    return (
      <div className={styles.logSection} data-testid="mira-work-log">
        <p className={styles.logEmptyLine}>No drafts kept recently</p>
      </div>
    );
  }
  const nowMs = Date.now();
  return (
    <div className={styles.logSection} data-testid="mira-work-log">
      <div className={styles.logSectionH}>
        <span className={styles.logSectionTitle}>
          {rows.length === 1
            ? "Mira kept 1 draft recently"
            : `Mira kept ${rows.length} drafts recently`}
        </span>
      </div>
      <div className={styles.apLog} role="list" aria-label="Recently kept drafts">
        {rows.map((item) => {
          const timeLabel = relativeTime(item.updatedAt, nowMs);
          return (
            <div key={item.id} className={styles.apLogRow} role="listitem">
              <span className={styles.apLogText}>{`Kept “${item.title}”`}</span>
              {timeLabel ? <span className={styles.apLogTime}>{timeLabel}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
