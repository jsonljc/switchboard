import type { IdentitySpec, CartridgeManifest } from "@switchboard/schemas";
import type { HealthCheck } from "../api-client-types";
import { SwitchboardGovernanceClient } from "./governance";

export class SwitchboardSettingsClient extends SwitchboardGovernanceClient {
  // Identity
  async getIdentitySpec(id: string) {
    return this.request<{ spec: IdentitySpec }>(`/api/identity/specs/${id}`);
  }

  async getIdentitySpecByPrincipal(principalId: string) {
    return this.request<{ spec: IdentitySpec }>(`/api/identity/specs/by-principal/${principalId}`);
  }

  async updateIdentitySpec(id: string, data: Partial<IdentitySpec>) {
    return this.request<{ spec: IdentitySpec }>(`/api/identity/specs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async createIdentitySpec(data: Omit<IdentitySpec, "id" | "createdAt" | "updatedAt">) {
    return this.request<{ spec: IdentitySpec }>("/api/identity/specs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Health
  async healthCheck() {
    return this.request<{ healthy: boolean }>("/api/health");
  }

  async deepHealthCheck() {
    return this.request<HealthCheck>("/api/health/deep");
  }

  // Cartridges
  async listCartridges() {
    return this.request<{ cartridges: CartridgeManifest[] }>("/api/cartridges");
  }

  // Connections
  async listConnections() {
    return this.request<{ connections: unknown[] }>("/api/connections");
  }

  async createConnection(body: {
    serviceId: string;
    serviceName: string;
    authType: string;
    credentials: Record<string, unknown>;
    scopes?: string[];
  }) {
    return this.request<{ connection: unknown }>("/api/connections", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getConnection(id: string) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}`);
  }

  async updateConnection(
    id: string,
    body: {
      serviceName?: string;
      authType?: string;
      credentials?: Record<string, unknown>;
      scopes?: string[];
    },
  ) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteConnection(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/connections/${id}`, {
      method: "DELETE",
    });
  }

  async testConnection(id: string) {
    return this.request<{ healthy: boolean; detail?: string }>(`/api/connections/${id}/test`, {
      method: "POST",
    });
  }

  // Organization Config
  async getOrgConfig(orgId: string) {
    return this.request<{ config: unknown }>(`/api/organizations/${orgId}/config`);
  }

  async updateOrgConfig(
    orgId: string,
    body: {
      name?: string;
      runtimeType?: string;
      runtimeConfig?: Record<string, unknown>;
      governanceProfile?: string;
      onboardingComplete?: boolean;
    },
  ) {
    return this.request<{ config: unknown }>(`/api/organizations/${orgId}/config`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async getIntegrationGuide(orgId: string, runtimeType?: string) {
    const qs = runtimeType ? `?runtimeType=${runtimeType}` : "";
    return this.request<{ guide: unknown }>(`/api/organizations/${orgId}/integration${qs}`);
  }

  // Managed Provisioning
  async provision(
    orgId: string,
    body: {
      channels: Array<{
        channel: string;
        botToken: string;
        webhookSecret?: string;
        signingSecret?: string;
      }>;
    },
  ) {
    return this.request<{
      channels: Array<{
        channel: string;
        botUsername?: string;
        webhookUrl?: string;
        status: string;
        note?: string;
      }>;
      provisioningStatus: string;
    }>(`/api/organizations/${orgId}/provision`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getManagedChannels(orgId: string) {
    return this.request<{
      channels: Array<{
        id: string;
        channel: string;
        botUsername: string | null;
        webhookPath: string;
        webhookRegistered: boolean;
        status: string;
        statusDetail: string | null;
        lastHealthCheck: string | null;
        createdAt: string;
      }>;
    }>(`/api/organizations/${orgId}/channels`);
  }

  async deleteChannel(orgId: string, channelId: string) {
    return this.request<{ deleted: boolean }>(`/api/organizations/${orgId}/channels/${channelId}`, {
      method: "DELETE",
    });
  }

  // Post-onboarding handoff
  async triggerHandoff(orgId: string, principalId: string) {
    return this.request<{ triggered: boolean; message: string }>(
      `/api/organizations/${orgId}/handoff`,
      {
        method: "POST",
        body: JSON.stringify({ principalId }),
      },
    );
  }
}
