// ---------------------------------------------------------------------------
// Publisher Blocklist Manager — Manage publisher block lists
// ---------------------------------------------------------------------------

import type { PublisherBlocklist } from "./types.js";

export class PublisherBlocklistManager {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async list(adAccountId: string): Promise<PublisherBlocklist[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const url =
      `${this.baseUrl}/${accountId}/publisher_block_lists` +
      `?fields=id,name,app_publishers` +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const lists = (data.data ?? []) as Record<string, unknown>[];

    return lists.map((item) => ({
      id: String(item.id),
      name: String(item.name ?? ""),
      publishers: Array.isArray(item.app_publishers) ? (item.app_publishers as string[]) : [],
      createdAt: (item.created_time as string) ?? null,
    }));
  }

  async create(
    adAccountId: string,
    name: string,
    publishers: string[],
  ): Promise<PublisherBlocklist> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const url =
      `${this.baseUrl}/${accountId}/publisher_block_lists` + `?access_token=${this.accessToken}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, app_publishers: publishers }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    return {
      id: String(result.id),
      name,
      publishers,
      createdAt: null,
    };
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
