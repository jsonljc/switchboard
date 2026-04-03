import type { SkillStore } from "./interfaces.js";

export class SkillRetriever {
  private readonly store: SkillStore;
  private readonly orgId: string;
  private readonly employeeId: string;

  constructor(store: SkillStore, orgId: string, employeeId: string) {
    this.store = store;
    this.orgId = orgId;
    this.employeeId = employeeId;
  }

  async getRelevant(
    taskType: string,
    format?: string,
    topK?: number,
  ): Promise<Array<{ id: string; pattern: string; score: number; version: number }>> {
    return this.store.getRelevant(this.orgId, this.employeeId, taskType, format, topK);
  }
}
