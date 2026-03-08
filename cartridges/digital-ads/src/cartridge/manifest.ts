// ---------------------------------------------------------------------------
// Digital Ads Cartridge Manifest
// ---------------------------------------------------------------------------
// Composes action definitions from domain-specific fragment files.
// ---------------------------------------------------------------------------

import type { CartridgeManifest } from "./types.js";
import { coreActions } from "./manifest/core-actions.js";
import { mutationActions } from "./manifest/mutation-actions.js";
import { reportingSignalActions } from "./manifest/reporting-signal-actions.js";
import { audienceActions } from "./manifest/audience-actions.js";
import { budgetOptimizationActions } from "./manifest/budget-optimization-actions.js";
import { creativeActions } from "./manifest/creative-actions.js";
import { experimentStrategyActions } from "./manifest/experiment-strategy-actions.js";
import { complianceMeasurementActions } from "./manifest/compliance-measurement-actions.js";
import { pacingAlertingForecastingActions } from "./manifest/pacing-alerting-forecasting-actions.js";
import { memoryGeoKpiActions } from "./manifest/memory-geo-kpi-actions.js";

export const DIGITAL_ADS_MANIFEST: CartridgeManifest = {
  id: "digital-ads",
  name: "Digital Ads",
  version: "1.0.0",
  description:
    "Multi-platform ad performance diagnostics, campaign management, reporting, signal health, audience management, bid/budget optimization, creative management, A/B testing, automated optimization, and strategy planning.",
  requiredConnections: ["meta-ads"],
  defaultPolicies: ["digital-ads-default"],
  actions: [
    ...coreActions,
    ...mutationActions,
    ...reportingSignalActions,
    ...audienceActions,
    ...budgetOptimizationActions,
    ...creativeActions,
    ...experimentStrategyActions,
    ...complianceMeasurementActions,
    ...pacingAlertingForecastingActions,
    ...memoryGeoKpiActions,
  ],
};
