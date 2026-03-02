/**
 * CRM Advisor Registry — resolves the correct set of CRM advisors
 * for pipeline health and activity cadence analysis.
 */

export { PipelineHealthAdvisor } from "./pipeline-health.js";
export type { PipelineHealthInput, PipelineHealthFinding } from "./pipeline-health.js";

export { ActivityCadenceAdvisor } from "./activity-cadence.js";
export type { ActivityCadenceInput, ActivityCadenceFinding } from "./activity-cadence.js";

import { PipelineHealthAdvisor } from "./pipeline-health.js";
import { ActivityCadenceAdvisor } from "./activity-cadence.js";

export interface CrmAdvisorConfig {
  stalledThresholdDays?: number;
  dormantThresholdDays?: number;
  followupThresholdDays?: number;
}

/**
 * Create all CRM advisors with shared configuration.
 */
export function createCrmAdvisors(config?: CrmAdvisorConfig) {
  return {
    pipelineHealth: new PipelineHealthAdvisor({
      stalledThresholdDays: config?.stalledThresholdDays,
    }),
    activityCadence: new ActivityCadenceAdvisor({
      dormantThresholdDays: config?.dormantThresholdDays,
      followupThresholdDays: config?.followupThresholdDays,
    }),
  };
}
