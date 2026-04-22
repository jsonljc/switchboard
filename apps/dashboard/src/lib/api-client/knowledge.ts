import { SwitchboardDashboardClient } from "./dashboard";

export class SwitchboardKnowledgeClient extends SwitchboardDashboardClient {
  async uploadKnowledge(body: Record<string, unknown>) {
    return this.request<{ documentId: string; fileName: string; chunksCreated: number }>(
      "/api/knowledge/upload",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async listKnowledgeDocuments(agentId?: string) {
    const params = agentId ? `?agentId=${agentId}` : "";
    return this.request<{ documents: unknown[] }>(`/api/knowledge/documents${params}`);
  }

  async deleteKnowledgeDocument(documentId: string) {
    return this.request<{ deleted: number }>(`/api/knowledge/documents/${documentId}`, {
      method: "DELETE",
    });
  }

  async createCorrection(body: Record<string, unknown>) {
    return this.request<{ documentId: string; correctionId: string }>(
      "/api/knowledge/corrections",
      { method: "POST", body: JSON.stringify(body) },
    );
  }
}
