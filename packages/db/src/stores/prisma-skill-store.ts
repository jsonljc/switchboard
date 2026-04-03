import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/memory SkillStore)
// ---------------------------------------------------------------------------

interface SkillStore {
  getRelevant(
    orgId: string,
    employeeId: string,
    taskType: string,
    format?: string,
    topK?: number,
  ): Promise<Array<{ id: string; pattern: string; score: number; version: number }>>;
  save(
    orgId: string,
    employeeId: string,
    skill: { type: string; pattern: string; evidence: string[]; channel?: string },
  ): Promise<void>;
  evolve(skillId: string, newPattern: string, evidence: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Prisma Skill Store
// ---------------------------------------------------------------------------

export class PrismaSkillStore implements SkillStore {
  constructor(private prisma: PrismaDbClient) {}

  async getRelevant(
    orgId: string,
    employeeId: string,
    taskType: string,
    format?: string,
    topK: number = 10,
  ): Promise<Array<{ id: string; pattern: string; score: number; version: number }>> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      employeeId,
      type: taskType,
    };
    if (format) {
      where.channel = format;
    }

    const rows = await this.prisma.employeeSkill.findMany({
      where,
      orderBy: { performanceScore: "desc" },
      take: topK,
    });

    return rows.map(
      (r: { id: string; pattern: string; performanceScore: number; version: number }) => ({
        id: r.id,
        pattern: r.pattern,
        score: r.performanceScore,
        version: r.version,
      }),
    );
  }

  async save(
    orgId: string,
    employeeId: string,
    skill: { type: string; pattern: string; evidence: string[]; channel?: string },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.employeeSkill.create({
      data: {
        id: randomUUID(),
        employeeId,
        organizationId: orgId,
        type: skill.type,
        pattern: skill.pattern,
        evidence: skill.evidence,
        channel: skill.channel ?? null,
        version: 1,
        performanceScore: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async evolve(skillId: string, newPattern: string, evidence: string[]): Promise<void> {
    const existing = await this.prisma.employeeSkill.findFirst({
      where: { id: skillId },
    });
    if (!existing) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const mergedEvidence = [...(existing.evidence as string[]), ...evidence];

    await this.prisma.employeeSkill.update({
      where: { id: skillId },
      data: {
        pattern: newPattern,
        evidence: mergedEvidence,
        version: existing.version + 1,
        updatedAt: new Date(),
      },
    });
  }
}
