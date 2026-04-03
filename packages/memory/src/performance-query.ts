import type { PerformanceStore } from "./interfaces.js";

export class PerformanceQuery {
  private readonly store: PerformanceStore;
  private readonly orgId: string;
  private readonly employeeId: string;

  constructor(store: PerformanceStore, orgId: string, employeeId: string) {
    this.store = store;
    this.orgId = orgId;
    this.employeeId = employeeId;
  }

  async getTop(
    channel: string,
    limit: number,
  ): Promise<Array<{ contentId: string; metrics: Record<string, number> }>> {
    return this.store.getTop(this.orgId, this.employeeId, channel, limit);
  }

  async getApprovalRate(): Promise<{ total: number; approved: number; rate: number }> {
    return this.store.getApprovalRate(this.orgId, this.employeeId);
  }
}
