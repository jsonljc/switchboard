import type { GovernanceMode } from "@switchboard/schemas";
import type { Vertical } from "../vertical.js";

export type GovernancePosture = {
  mode: GovernanceMode;
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
  /**
   * The vertical the deployment runs under (SH-3). Optional: the loader gates
   * (deterministic-safety-gate, pre-input-gate) populate it so the fail-closed
   * path can thread the same vertical into the (vertical, jurisdiction) loaders.
   * When absent (e.g. a non-loader gate wrote the posture last), the
   * cached-enforce path falls back to the default vertical (medspa), the
   * over-restrictive safe direction.
   */
  vertical?: Vertical;
};

export interface GovernancePostureCache {
  remember(deploymentId: string, posture: GovernancePosture): void;
  lastKnown(deploymentId: string): GovernancePosture | undefined;
}

export class InMemoryGovernancePostureCache implements GovernancePostureCache {
  private readonly store = new Map<string, GovernancePosture>();

  remember(deploymentId: string, posture: GovernancePosture): void {
    this.store.set(deploymentId, posture);
  }

  lastKnown(deploymentId: string): GovernancePosture | undefined {
    return this.store.get(deploymentId);
  }
}
