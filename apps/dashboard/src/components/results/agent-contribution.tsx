import { fmtSGD } from "@/app/(auth)/(mercury)/reports/components/format";
import type { AgentKey } from "@switchboard/schemas";
import type { AttributionData } from "./types";
import css from "./results.module.css";

export interface AgentContributionProps {
  attribution: AttributionData;
  /** Called when the user taps an agent header chip. All three agents are tappable. */
  onOpenAgent?: (agentKey: AgentKey) => void;
}

export function AgentContribution({ attribution, onOpenAgent }: AgentContributionProps) {
  return (
    <section className={css.agentContribution}>
      <p className={css.agentContributionEyebrow}>Who drove it</p>

      <div className={css.agentCards}>
        {/* Riley */}
        <article data-agent="riley" className={css.agentCard}>
          <header className={css.agentCardHeader}>
            <button
              type="button"
              className={css.agentChipBtn}
              onClick={() => onOpenAgent?.("riley")}
              aria-label="Open Riley panel"
            >
              <span className={`${css.agentDot} ${css.agentDotRiley}`} aria-hidden="true" />
              <span className={css.agentName}>Riley</span>
            </button>
          </header>
          <p className={css.agentValue}>{fmtSGD(attribution.riley.value)}</p>
          <p className={css.agentCaption}>{attribution.riley.caption}</p>
        </article>

        {/* Alex */}
        <article data-agent="alex" className={css.agentCard}>
          <header className={css.agentCardHeader}>
            <button
              type="button"
              className={css.agentChipBtn}
              onClick={() => onOpenAgent?.("alex")}
              aria-label="Open Alex panel"
            >
              <span className={`${css.agentDot} ${css.agentDotAlex}`} aria-hidden="true" />
              <span className={css.agentName}>Alex</span>
            </button>
          </header>
          <p className={css.agentValue}>{fmtSGD(attribution.alex.value)}</p>
          <p className={css.agentCaption}>{attribution.alex.caption}</p>
        </article>

        {/* Mira — not set up yet; NO number, NO fmtSGD call */}
        <article data-agent="mira" className={css.agentCard}>
          <header className={css.agentCardHeader}>
            <button
              type="button"
              className={css.agentChipBtn}
              onClick={() => onOpenAgent?.("mira")}
              aria-label="Open Mira panel"
            >
              <span className={`${css.agentDot} ${css.agentDotMira}`} aria-hidden="true" />
              <span className={css.agentName}>Mira</span>
            </button>
          </header>
          <p className={css.agentValueMuted}>Not set up yet</p>
        </article>
      </div>
    </section>
  );
}
