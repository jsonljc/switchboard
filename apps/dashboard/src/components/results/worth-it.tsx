import { fmtSGD } from "@/app/(auth)/(mercury)/reports/components/format";
import type { CostBreakdown } from "./types";
import css from "./results.module.css";

export function WorthIt({ cost, narrative }: { cost: CostBreakdown; narrative: string }) {
  return (
    <section className={css.worthIt}>
      <p className={css.worthItEyebrow}>Is it worth it?</p>

      <div className={css.worthItCells}>
        {/* Cell 1: You pay — co-weighted with "You saved" */}
        <div className={css.worthItCell}>
          <p className={css.worthItNum}>{fmtSGD(cost.paid)}</p>
          <p className={css.worthItLabel}>You pay</p>
        </div>

        {/* Cell 2: Market-rate alternative — explicit estimate label */}
        <div className={css.worthItCell}>
          <p className={css.worthItNum}>{fmtSGD(cost.alt)}</p>
          <p className={css.worthItLabel}>A salesperson + agency would cost</p>
          <p className={css.worthItEstimate}>market-rate estimate</p>
        </div>

        {/* Cell 3: You saved — amber emphasis, co-weighted (same scale as "You pay") */}
        <div className={css.worthItCell}>
          <p className={`${css.worthItNum} ${css.worthItNumAmber}`}>{fmtSGD(cost.saving)}</p>
          <p className={css.worthItLabel}>You saved</p>
        </div>
      </div>

      <p className={css.worthItNarrative}>{narrative}</p>
    </section>
  );
}
