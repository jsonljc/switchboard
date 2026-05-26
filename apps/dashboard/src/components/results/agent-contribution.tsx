import { fmtSGD } from "@/app/(auth)/(mercury)/reports/components/format";
import type { AttributionData } from "./types";
import css from "./results.module.css";

export function AgentContribution({ attribution }: { attribution: AttributionData }) {
  return (
    <section className={css.agentContribution}>
      <p className={css.agentContributionEyebrow}>Who drove it</p>

      <div className={css.agentCards}>
        {/* Riley */}
        <article data-agent="riley" className={css.agentCard}>
          <header className={css.agentCardHeader}>
            <span className={`${css.agentDot} ${css.agentDotRiley}`} aria-hidden="true" />
            <span className={css.agentName}>Riley</span>
          </header>
          <p className={css.agentValue}>{fmtSGD(attribution.riley.value)}</p>
          <p className={css.agentCaption}>{attribution.riley.caption}</p>
        </article>

        {/* Alex */}
        <article data-agent="alex" className={css.agentCard}>
          <header className={css.agentCardHeader}>
            <span className={`${css.agentDot} ${css.agentDotAlex}`} aria-hidden="true" />
            <span className={css.agentName}>Alex</span>
          </header>
          <p className={css.agentValue}>{fmtSGD(attribution.alex.value)}</p>
          <p className={css.agentCaption}>{attribution.alex.caption}</p>
        </article>

        {/* Mira — not set up yet; NO number, NO fmtSGD call */}
        <article data-agent="mira" className={css.agentCard}>
          <header className={css.agentCardHeader}>
            <span className={`${css.agentDot} ${css.agentDotMira}`} aria-hidden="true" />
            <span className={css.agentName}>Mira</span>
          </header>
          <p className={css.agentValueMuted}>Not set up yet</p>
        </article>
      </div>
    </section>
  );
}
