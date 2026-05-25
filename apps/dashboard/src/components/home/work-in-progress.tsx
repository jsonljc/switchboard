import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import type { WorkInProgressItem } from "./types";
import styles from "./home.module.css";

/**
 * Resolve a display name for an AgentKey using the canonical registry.
 * Falls back to capitalizing the key if somehow it isn't in the registry
 * (defensive, should not happen in practice).
 */
function agentDisplayName(key: AgentKey): string {
  return AGENT_REGISTRY[key]?.displayName ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * WorkInProgress — in-flight task list (quiet module, trace-honest).
 *
 * Presentational only. The multi-agent chain (e.g. "Riley → Mira → Alex") is rendered
 * ONLY when item.chain is non-null AND has ≥2 agents — meaning a real typed-handoff
 * trace backs it. Otherwise renders the simple form (primaryAgent stripe + text only).
 *
 * Empty → "No active handoffs right now." (no fabricated rows).
 * No ticker theater; no pulse; no progress affordances.
 */
export function WorkInProgress({ items }: { items: WorkInProgressItem[] }) {
  if (items.length === 0) {
    return (
      <section className={`${styles.module} ${styles.moduleQuiet}`} aria-label="Work in progress">
        <div className={styles.moduleH}>
          <h2>work in progress</h2>
        </div>
        <p className={styles.quietText} style={{ padding: "4px" }}>
          No active handoffs right now.
        </p>
      </section>
    );
  }

  return (
    <section className={`${styles.module} ${styles.moduleQuiet}`} aria-label="Work in progress">
      <div className={styles.moduleH}>
        <h2>work in progress</h2>
      </div>
      <ul className={styles.quietList} role="list">
        {items.map((item) => {
          const hasChain = item.chain !== null && item.chain.length >= 2;
          return (
            <li
              key={item.id}
              className={styles.quietRow}
              data-agent={item.primaryAgent}
              data-handoff={hasChain ? "true" : "false"}
            >
              <span className={styles.quietMark} aria-hidden="true" />
              <span className={styles.quietText}>
                {hasChain && (
                  <>
                    <span
                      aria-label={`Agent chain: ${item.chain!.map(agentDisplayName).join(" to ")}`}
                    >
                      {item.chain!.map((key, i) => (
                        <span key={key}>
                          {i > 0 && <span aria-hidden="true"> → </span>}
                          {agentDisplayName(key)}
                        </span>
                      ))}
                    </span>{" "}
                    {item.text}
                  </>
                )}
                {!hasChain && item.text}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
