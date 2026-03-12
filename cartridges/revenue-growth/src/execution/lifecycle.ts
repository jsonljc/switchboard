// ---------------------------------------------------------------------------
// Intervention Lifecycle — State machine for intervention governance
// ---------------------------------------------------------------------------
// Validates status transitions, enforces one-active-per-type rules,
// and manages measurement lifecycle.
//
// Valid transitions:
//   PROPOSED → APPROVED | DEFERRED | REJECTED
//   APPROVED → EXECUTING
//   EXECUTING → EXECUTED
//   DEFERRED → PROPOSED
// ---------------------------------------------------------------------------

import type { Intervention, GovernanceStatus } from "@switchboard/schemas";
import type { InterventionStore } from "../stores/interfaces.js";

// ---------------------------------------------------------------------------
// Transition rules
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<GovernanceStatus, GovernanceStatus[]> = {
  PROPOSED: ["APPROVED", "DEFERRED", "REJECTED"],
  APPROVED: ["EXECUTING"],
  EXECUTING: ["EXECUTED"],
  EXECUTED: [],
  DEFERRED: ["PROPOSED"],
  REJECTED: [],
};

// ---------------------------------------------------------------------------
// InterventionLifecycle — State machine
// ---------------------------------------------------------------------------

export class InterventionLifecycle {
  /**
   * Validate and apply a status transition on an intervention.
   * Throws if the transition is invalid.
   */
  transition(intervention: Intervention, targetStatus: GovernanceStatus): Intervention {
    const allowed = VALID_TRANSITIONS[intervention.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new Error(
        `Invalid transition: ${intervention.status} → ${targetStatus}. ` +
          `Allowed: ${allowed?.join(", ") || "none"}`,
      );
    }

    return {
      ...intervention,
      status: targetStatus,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Enforce that only one intervention per constraint type can be in an
   * active state (PROPOSED or APPROVED or EXECUTING). Defers older ones.
   */
  async enforceOneActivePerType(
    store: InterventionStore,
    constraintType: string,
    newIntervention: Intervention,
  ): Promise<Intervention[]> {
    const activeStatuses: GovernanceStatus[] = ["PROPOSED", "APPROVED", "EXECUTING"];
    const deferred: Intervention[] = [];

    // Get all active interventions (using a broad query, then filter)
    for (const status of activeStatuses) {
      const interventions = await store.listByAccount("", { status });
      for (const existing of interventions) {
        if (existing.constraintType === constraintType && existing.id !== newIntervention.id) {
          await store.updateStatus(existing.id, "DEFERRED");
          deferred.push({ ...existing, status: "DEFERRED" });
        }
      }
    }

    return deferred;
  }

  /**
   * Start the measurement phase for an intervention.
   * Sets measurementStartedAt and outcomeStatus to MEASURING.
   */
  startMeasurement(intervention: Intervention): Intervention {
    if (intervention.status !== "EXECUTING") {
      throw new Error(
        `Cannot start measurement on intervention with status ${intervention.status}. ` +
          "Intervention must be EXECUTING.",
      );
    }

    return {
      ...intervention,
      measurementStartedAt: new Date().toISOString(),
      outcomeStatus: "MEASURING",
      updatedAt: new Date().toISOString(),
    };
  }
}
