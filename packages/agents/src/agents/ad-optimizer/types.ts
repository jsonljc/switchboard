// ---------------------------------------------------------------------------
// Ad Optimizer — Dependency types
// ---------------------------------------------------------------------------

import type { ROASRecord } from "./roas-tracker.js";

/**
 * Dependencies injected into the Ad Optimizer handler.
 */
export interface AdOptimizerDeps {
  /** In-memory ROAS history for rolling window analysis. */
  roasHistory?: ROASRecord[];
}
