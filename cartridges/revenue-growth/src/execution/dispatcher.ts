// ---------------------------------------------------------------------------
// Cross-Cartridge Dispatcher — Routes interventions through governance
// ---------------------------------------------------------------------------
// Provides an interface for dispatching approved interventions to external
// systems, with governance level gating (AUTO, APPROVAL_REQUIRED, BLOCKED).
// ---------------------------------------------------------------------------

import type { Intervention } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GovernanceGate = "AUTO" | "APPROVAL_REQUIRED" | "BLOCKED";

export interface DispatchResult {
  dispatched: boolean;
  governanceLevel: GovernanceGate;
  reason: string;
  externalRef?: string;
}

// ---------------------------------------------------------------------------
// InterventionDispatcher interface
// ---------------------------------------------------------------------------

export interface InterventionDispatcher {
  dispatch(intervention: Intervention, governanceLevel: GovernanceGate): Promise<DispatchResult>;
}

// ---------------------------------------------------------------------------
// InMemoryDispatcher — Test/development implementation
// ---------------------------------------------------------------------------

export class InMemoryDispatcher implements InterventionDispatcher {
  private readonly dispatched: Array<{
    intervention: Intervention;
    result: DispatchResult;
  }> = [];

  async dispatch(
    intervention: Intervention,
    governanceLevel: GovernanceGate,
  ): Promise<DispatchResult> {
    switch (governanceLevel) {
      case "AUTO": {
        const result: DispatchResult = {
          dispatched: true,
          governanceLevel: "AUTO",
          reason: `Intervention ${intervention.id} auto-dispatched for ${intervention.actionType}`,
          externalRef: `dispatch-${crypto.randomUUID().slice(0, 8)}`,
        };
        this.dispatched.push({ intervention, result });
        return result;
      }

      case "APPROVAL_REQUIRED": {
        const result: DispatchResult = {
          dispatched: false,
          governanceLevel: "APPROVAL_REQUIRED",
          reason: `Intervention ${intervention.id} requires approval before dispatch`,
        };
        this.dispatched.push({ intervention, result });
        return result;
      }

      case "BLOCKED": {
        const result: DispatchResult = {
          dispatched: false,
          governanceLevel: "BLOCKED",
          reason: `Intervention ${intervention.id} is blocked by governance policy`,
        };
        this.dispatched.push({ intervention, result });
        return result;
      }
    }
  }

  /** Get all dispatch attempts (for testing) */
  getDispatched(): ReadonlyArray<{ intervention: Intervention; result: DispatchResult }> {
    return this.dispatched;
  }

  /** Clear dispatch history (for testing) */
  clear(): void {
    this.dispatched.length = 0;
  }
}
