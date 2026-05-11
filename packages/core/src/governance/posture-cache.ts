import type { GovernanceMode } from "@switchboard/schemas";

export type GovernancePosture = {
  mode: GovernanceMode;
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
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
