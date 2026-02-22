import type { SystemRiskPosture } from "@switchboard/schemas";

export interface RiskPostureStore {
  get(): Promise<SystemRiskPosture>;
  set(posture: SystemRiskPosture): Promise<void>;
}

export class InMemoryRiskPostureStore implements RiskPostureStore {
  private posture: SystemRiskPosture = "normal";

  async get(): Promise<SystemRiskPosture> {
    return this.posture;
  }

  async set(posture: SystemRiskPosture): Promise<void> {
    this.posture = posture;
  }
}
