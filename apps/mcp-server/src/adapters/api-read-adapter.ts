/**
 * API-backed read adapter for MCP server.
 * Delegates read operations to the correct API endpoints.
 */
import type { McpApiClient } from "../api-client.js";
import type { ReadOperation, ReadResult } from "@switchboard/core";
import { randomUUID } from "node:crypto";

export class ApiReadAdapter {
  constructor(private client: McpApiClient) {}

  async query(op: ReadOperation): Promise<ReadResult> {
    const traceId = op.traceId ?? randomUUID();

    switch (op.operation) {
      case "getCampaign": {
        const campaignId = op.parameters.campaignId as string;
        const { data } = await this.client.get<{ campaign: unknown }>(
          `/api/campaigns/${encodeURIComponent(campaignId)}`,
        );
        return { data: (data as { campaign: unknown }).campaign ?? data, traceId };
      }

      case "searchCampaigns": {
        const query = op.parameters.query as string;
        const limit = op.parameters.limit as number | undefined;
        const params = new URLSearchParams({ query });
        if (limit) params.set("limit", String(limit));
        const { data } = await this.client.get<{ campaigns: unknown[] }>(
          `/api/campaigns/search?${params.toString()}`,
        );
        return { data, traceId };
      }

      default:
        throw new Error(`Unsupported read operation: ${op.operation}`);
    }
  }
}
