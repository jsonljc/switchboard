import type { ResultsModel } from "./results-model";
import { fmtRatio } from "./results-model";
import styles from "./results.module.css";

export function WhatsWorking({ model }: { model: ResultsModel }) {
  const { funnelNarrative, bestCampaign, worstCampaign } = model;

  const underwaterWorst = worstCampaign && worstCampaign.roas < 1 ? worstCampaign : null;

  return (
    <div className={styles.whatsWorking}>
      <p className={styles.whatsWorkingNarrative}>
        {funnelNarrative.text}
        <span className={styles.whatsWorkingByline}>{funnelNarrative.marker}</span>
      </p>

      {bestCampaign && (
        <p className={styles.whatsWorkingCampaign}>
          <span className={styles.whatsWorkingEmphasis}>{bestCampaign.name}</span> is your strongest
          at {fmtRatio(bestCampaign.roas)}
          {underwaterWorst && (
            <>
              {"; "}
              <span className={styles.whatsWorkingEmphasis}>{underwaterWorst.name}</span> is
              underwater at {fmtRatio(underwaterWorst.roas)} — worth a look.
            </>
          )}
          {!underwaterWorst && "."}
        </p>
      )}
    </div>
  );
}
