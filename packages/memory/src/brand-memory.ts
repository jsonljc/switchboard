import type { BrandMemoryStore } from "./interfaces.js";

export class BrandMemory {
  private readonly store: BrandMemoryStore;
  private readonly orgId: string;
  private readonly employeeId: string;

  constructor(store: BrandMemoryStore, orgId: string, employeeId: string) {
    this.store = store;
    this.orgId = orgId;
    this.employeeId = employeeId;
  }

  async search(
    query: string,
    topK?: number,
  ): Promise<Array<{ content: string; similarity: number }>> {
    return this.store.search(this.orgId, this.employeeId, query, topK);
  }

  async ingest(
    documentId: string,
    content: string,
    sourceType: "brand" | "correction" | "example",
  ): Promise<void> {
    return this.store.ingest(this.orgId, this.employeeId, documentId, content, sourceType);
  }
}
