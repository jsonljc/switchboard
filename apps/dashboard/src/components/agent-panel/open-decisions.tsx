"use client";

import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { QueryStates } from "@/components/query-states";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import type { Decision } from "@/lib/decisions/types";
import styles from "./agent-panel.module.css";

export interface OpenDecisionsProps {
  // Accepts any PanelAgentKey (mira no longer type-fenced out). The AgentPanel
  // routes mira to its own desk-fed composition in MiraPanel; the alex/riley
  // hosts pass alex/riley here. The decision-feed hook is keyed by AgentKey.
  agentKey: PanelAgentKey;
  onOpenDecision: (decision: Decision) => void;
}

/**
 * Slot ③: Open decisions — shows this agent's open decisions, each a tappable
 * row that routes OUT to the decision-detail sheet via onOpenDecision.
 *
 * Read-only: no approve/reject/skip controls here. The Inbox owns those actions.
 *
 * States (three-states invariant: loading / error / data):
 *   loading  → skeleton (never flash error/empty during load)
 *   error    → "Couldn't load decisions" (never "0 / nothing waiting")
 *   empty    → "Nothing waiting on you from {Name}"
 *   has data → section header with count + one tappable row per decision
 */
export function OpenDecisions({ agentKey, onOpenDecision }: OpenDecisionsProps) {
  const feed = useDecisionFeed(agentKey);
  const display = agentDisplay[agentKey];

  // Route the four-way gate through <QueryStates>, which derives state from
  // {data, error} only. These hooks are `enabled: !!keys`, so during keys-pending
  // isLoading is false — a plain `if (isLoading)` gate is skipped and flashes a
  // false error/empty. The {data, error} rule treats keys-pending as loading.
  return (
    <QueryStates
      query={feed}
      isEmpty={(d) => d.decisions.length === 0}
      loading={
        <div className={styles.decisionSection} data-kind="loading" aria-busy="true">
          <div className={styles.decisionSkeleton} />
        </div>
      }
      error={
        <div className={styles.decisionSection}>
          <p className={`${styles.decisionEmptyLine} ${styles.decisionEmptyErr}`}>
            {"Couldn't load decisions"}
          </p>
        </div>
      }
      empty={
        <div className={styles.decisionSection}>
          <p
            className={styles.decisionEmptyLine}
          >{`Nothing waiting on you from ${display.name}`}</p>
        </div>
      }
    >
      {({ decisions, counts }) => (
        <div className={styles.decisionSection}>
          {/* Section header: label + count */}
          <div className={styles.decisionSectionH}>
            <span className={styles.decisionSectionTitle}>Needs you</span>
            <span className={styles.decisionSectionMeta}>{counts.total}</span>
          </div>

          {/* Decision list */}
          <ul className={styles.decisionList} role="list">
            {decisions.map((decision) => {
              // Gist: humanSummary is the ready summary; prepend contactName when present
              // and not already contained in the summary (e.g. "Reply to Maya R." covers it).
              const contactName = decision.meta.contactName;
              const gist =
                contactName && !decision.humanSummary.includes(contactName)
                  ? `${contactName} · ${decision.humanSummary}`
                  : decision.humanSummary;

              return (
                <li key={decision.id} role="listitem">
                  <button
                    type="button"
                    className={styles.decisionRow}
                    onClick={() => onOpenDecision(decision)}
                    aria-label={gist}
                  >
                    <span className={styles.decisionGist}>{gist}</span>
                    {/* Chevron-right indicator */}
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
              );
            })}
          </ul>
        </div>
      )}
    </QueryStates>
  );
}
