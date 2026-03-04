import type { PrismaClient } from "@prisma/client";

export interface CadenceInstanceRecord {
  id: string;
  cadenceDefinitionId: string;
  patientId: string;
  organizationId: string | null;
  status: string;
  currentStepIndex: number;
  stepStates: unknown;
  startedAt: Date;
  lastEvaluatedAt: Date | null;
  nextEvaluationAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CadenceStore {
  getActive(): Promise<CadenceInstanceRecord[]>;
  getById(id: string): Promise<CadenceInstanceRecord | null>;
  save(record: CadenceInstanceRecord): Promise<void>;
  complete(id: string): Promise<void>;
  listByPatient(patientId: string): Promise<CadenceInstanceRecord[]>;
}

export class PrismaCadenceStore implements CadenceStore {
  constructor(private prisma: PrismaClient) {}

  async getActive(): Promise<CadenceInstanceRecord[]> {
    const rows = await this.prisma.cadenceInstance.findMany({
      where: { status: "active" },
    });
    return rows.map(toRecord);
  }

  async getById(id: string): Promise<CadenceInstanceRecord | null> {
    const row = await this.prisma.cadenceInstance.findUnique({
      where: { id },
    });
    return row ? toRecord(row) : null;
  }

  async save(record: CadenceInstanceRecord): Promise<void> {
    await this.prisma.cadenceInstance.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        cadenceDefinitionId: record.cadenceDefinitionId,
        patientId: record.patientId,
        organizationId: record.organizationId,
        status: record.status,
        currentStepIndex: record.currentStepIndex,
        stepStates: record.stepStates as object,
        startedAt: record.startedAt,
        lastEvaluatedAt: record.lastEvaluatedAt,
        nextEvaluationAt: record.nextEvaluationAt,
        completedAt: record.completedAt,
      },
      update: {
        status: record.status,
        currentStepIndex: record.currentStepIndex,
        stepStates: record.stepStates as object,
        lastEvaluatedAt: record.lastEvaluatedAt,
        nextEvaluationAt: record.nextEvaluationAt,
        completedAt: record.completedAt,
      },
    });
  }

  async complete(id: string): Promise<void> {
    await this.prisma.cadenceInstance.update({
      where: { id },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  }

  async listByPatient(patientId: string): Promise<CadenceInstanceRecord[]> {
    const rows = await this.prisma.cadenceInstance.findMany({
      where: { patientId },
      orderBy: { startedAt: "desc" },
    });
    return rows.map(toRecord);
  }
}

function toRecord(row: {
  id: string;
  cadenceDefinitionId: string;
  patientId: string;
  organizationId: string | null;
  status: string;
  currentStepIndex: number;
  stepStates: unknown;
  startedAt: Date;
  lastEvaluatedAt: Date | null;
  nextEvaluationAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CadenceInstanceRecord {
  return {
    id: row.id,
    cadenceDefinitionId: row.cadenceDefinitionId,
    patientId: row.patientId,
    organizationId: row.organizationId,
    status: row.status,
    currentStepIndex: row.currentStepIndex,
    stepStates: row.stepStates,
    startedAt: row.startedAt,
    lastEvaluatedAt: row.lastEvaluatedAt,
    nextEvaluationAt: row.nextEvaluationAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
