export { AD_OPTIMIZER_PORT } from "./port.js";
export { AdOptimizerHandler } from "./handler.js";
export type { AdOptimizerDeps } from "./types.js";
export {
  addROASRecord,
  getROASWindow,
  shouldIncreaseBudget,
  shouldDecreaseBudget,
  type ROASRecord,
} from "./roas-tracker.js";
