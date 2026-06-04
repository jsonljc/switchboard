import { getMetrics } from "./metrics.js";
import type { GovernanceVerdictRecord } from "../governance/governance-verdict-store/types.js";

/**
 * Verdict-store onWrite hook: mirrors every persisted GovernanceVerdict row into
 * the process's metrics registry (api and chat both register the counter, so the
 * pre-input gate and the four afterSkill gates are covered wherever they run).
 * Counting at the write seam keeps the metric incapable of drifting from the
 * system of record. Never throws.
 */
export async function recordGovernanceVerdictMetric(
  record: GovernanceVerdictRecord,
): Promise<void> {
  getMetrics().governanceVerdictsRecorded.inc({
    deployment_id: record.deploymentId,
    source_guard: record.sourceGuard,
    action: record.action,
    audit_level: record.auditLevel,
  });
}
