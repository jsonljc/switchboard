import type { Playbook, ScanResult, DashboardOverview } from "@switchboard/schemas";
import { SwitchboardAgentsClient } from "./agents";

export class SwitchboardDashboardClient extends SwitchboardAgentsClient {
  // ── Playbook ──

  async getPlaybook(): Promise<{ playbook: Playbook; step: number; complete: boolean }> {
    return this.request("/api/playbook");
  }

  async updatePlaybook(body: {
    playbook?: Playbook;
    step?: number;
  }): Promise<{ playbook: Playbook; step: number }> {
    return this.request("/api/playbook", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  // ── Website Scan ──

  async scanWebsite(body: {
    url: string;
    sourceType?: string;
  }): Promise<{ result: ScanResult; error?: string }> {
    return this.request("/api/website-scan", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async simulateChat(body: {
    playbook: Playbook;
    userMessage: string;
  }): Promise<{ alexMessage: string; annotations: string[] }> {
    return this.request("/api/simulate-chat", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ── Dashboard ──

  async getDashboardOverview(orgId: string): Promise<DashboardOverview> {
    return this.request<DashboardOverview>(`/api/${orgId}/dashboard/overview`);
  }

  async updateTask(orgId: string, taskId: string, body: Record<string, unknown>) {
    return this.request(`/api/${orgId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async getRoiSummary(orgId: string, params?: { from?: string; to?: string; breakdown?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set("from", params.from);
    if (params?.to) searchParams.set("to", params.to);
    if (params?.breakdown) searchParams.set("breakdown", params.breakdown);
    const qs = searchParams.toString();
    return this.request(`/api/${orgId}/roi/summary${qs ? `?${qs}` : ""}`);
  }
}
