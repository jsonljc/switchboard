import type { PrismaClient } from "@prisma/client";
import type { RiskPostureStore } from "@switchboard/core";
import type { SystemRiskPosture } from "@switchboard/schemas";

export class PrismaRiskPostureStore implements RiskPostureStore {
  constructor(private prisma: PrismaClient) {}

  async get(): Promise<SystemRiskPosture> {
    const row = await this.prisma.systemRiskPosture.findUnique({
      where: { id: "singleton" },
    });
    if (!row) return "normal";
    return row.posture as SystemRiskPosture;
  }

  async set(posture: SystemRiskPosture): Promise<void> {
    await this.prisma.systemRiskPosture.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", posture },
      update: { posture },
    });
  }
}
