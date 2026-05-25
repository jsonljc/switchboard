import type { ReactNode } from "react";
import Link from "next/link";
import type { Decision } from "@/lib/decisions/types";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { DecisionCard } from "@/components/decisions/decision-card";
import styles from "./home.module.css";

interface NeedsYouProps {
  decisions: Decision[];
  onAction?: (decision: Decision, action: "primary" | "secondary") => void;
  /**
   * Optional per-item renderer. When provided, the composer (HomePage, Task 8)
   * supplies a live, action-wired card (each owning its own mutation hook) and
   * NeedsYou stays the layout owner: the ≤2 cap, the section header, and the
   * "See all in Inbox" link. When absent, NeedsYou falls back to a plain
   * DecisionCard driven by `onAction` (the presentational default used by its
   * own unit tests). `index` is the position in the visible (capped) list.
   */
  renderItem?: (decision: Decision, index: number) => ReactNode;
}

/**
 * NeedsYou — surfaces the ≤2 most-urgent decisions on Home.
 *
 * Layout owner: the ≤2 cap, the section header + decision count, and the
 * "See all in Inbox" link live here. Card mutation/undo wiring is delegated —
 * either to `renderItem` (HomePage's live cards, each with its own hook) or,
 * for the presentational default, to the `onAction` callback.
 *
 * Empty state renders nothing — the Verdict module owns the all-clear message.
 */
export function NeedsYou({ decisions, onAction, renderItem }: NeedsYouProps) {
  if (decisions.length === 0) return null;

  const visible = decisions.slice(0, 2);

  return (
    <section className={styles.module} aria-label="Needs you">
      <div className={styles.moduleH}>
        <h2>needs you</h2>
        <span className={styles.hMeta}>
          {decisions.length} decision{decisions.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className={styles.needsSection}>
        {visible.map((decision, i) => {
          if (renderItem) {
            return <div key={decision.id}>{renderItem(decision, i)}</div>;
          }
          const cardProps = mapToDecisionCard(decision, i);
          return (
            <div key={decision.id} data-testid="decision-card">
              <DecisionCard
                {...cardProps}
                onPrimary={() => onAction?.(decision, "primary")}
                onSecondary={() => onAction?.(decision, "secondary")}
              />
            </div>
          );
        })}
        {decisions.length > 2 && (
          <Link href="/inbox" className={styles.permslineLink}>
            See all in Inbox <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </section>
  );
}
