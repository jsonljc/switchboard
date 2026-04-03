export interface BrandMemoryStore {
  search(
    orgId: string,
    employeeId: string,
    query: string,
    topK?: number,
  ): Promise<Array<{ content: string; similarity: number }>>;
  ingest(
    orgId: string,
    employeeId: string,
    documentId: string,
    content: string,
    sourceType: "brand" | "correction" | "example",
  ): Promise<void>;
}

export interface SkillStore {
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

export interface PerformanceStore {
  record(
    orgId: string,
    employeeId: string,
    event: {
      contentId: string;
      outcome: "approved" | "rejected";
      feedback?: string;
      metrics?: Record<string, number>;
    },
  ): Promise<void>;
  getTop(
    orgId: string,
    employeeId: string,
    channel: string,
    limit: number,
  ): Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
  getApprovalRate(
    orgId: string,
    employeeId: string,
  ): Promise<{ total: number; approved: number; rate: number }>;
}

export interface EmployeeMemory {
  brand: BrandMemoryStore;
  skills: SkillStore;
  performance: PerformanceStore;
}
