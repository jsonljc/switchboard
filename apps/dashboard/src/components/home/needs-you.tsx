import Link from "next/link";
import type { Decision } from "@/lib/decisions/types";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { DecisionCard } from "@/components/decisions/decision-card";
import styles from "./home.module.css";

interface NeedsYouProps {
  decisions: Decision[];
  onAction?: (decision: Decision, action: "primary" | "secondary") => void;
}

/**
 * NeedsYou — surfaces the ≤2 most-urgent decisions on Home.
 *
 * Presentational only: never fetches, never mutates. Delegates action callbacks
 * via onAction for the HomePage composer to wire up mutations + undo toasts (Task 8).
 *
 * Empty state renders nothing — the Verdict module owns the all-clear message.
 */
export function NeedsYou({ decisions, onAction }: NeedsYouProps) {
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
