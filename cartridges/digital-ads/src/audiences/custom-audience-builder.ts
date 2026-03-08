// ---------------------------------------------------------------------------
// Custom Audience Builder — Custom Audience creation
// ---------------------------------------------------------------------------

import type { CreateCustomAudienceParams, CustomAudienceInfo } from "./types.js";

export class CustomAudienceBuilder {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async create(params: CreateCustomAudienceParams): Promise<CustomAudienceInfo> {
    const accountId = params.adAccountId.startsWith("act_")
      ? params.adAccountId
      : `act_${params.adAccountId}`;

    const url = `${this.baseUrl}/${accountId}/customaudiences?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      description: params.description ?? "",
      subtype: this.mapSourceToSubtype(params.source),
    };

    if (params.rule) {
      body.rule = JSON.stringify(params.rule);
    }
    if (params.retentionDays) {
      body.retention_days = params.retentionDays;
    }
    if (params.customerFileSource) {
      body.customer_file_source = params.customerFileSource;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errorBody.error as Record<string, unknown> | undefined;
      throw new Error(
        `Failed to create custom audience: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      id: String(data.id),
      name: params.name,
      description: params.description ?? null,
      subtype: this.mapSourceToSubtype(params.source),
      approximateCount: null,
      deliveryStatus: null,
      retentionDays: params.retentionDays ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  async list(adAccountId: string, limit = 50): Promise<CustomAudienceInfo[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const url =
      `${this.baseUrl}/${accountId}/customaudiences?fields=` +
      "id,name,description,subtype,approximate_count,delivery_status,retention_days,time_created" +
      `&limit=${limit}&access_token=${this.accessToken}`;

    const results: CustomAudienceInfo[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) break;
      const data = (await response.json()) as Record<string, unknown>;
      const audiences = (data.data ?? []) as Record<string, unknown>[];

      for (const aud of audiences) {
        results.push({
          id: String(aud.id),
          name: String(aud.name ?? ""),
          description: (aud.description as string) ?? null,
          subtype: String(aud.subtype ?? ""),
          approximateCount: aud.approximate_count ? Number(aud.approximate_count) : null,
          deliveryStatus:
            ((aud.delivery_status as Record<string, unknown>)?.status as string) ?? null,
          retentionDays: aud.retention_days ? Number(aud.retention_days) : null,
          createdAt: (aud.time_created as string) ?? null,
        });
      }

      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }

    return results;
  }

  async getInsights(audienceId: string): Promise<{ approximateCount: number }> {
    const url =
      `${this.baseUrl}/${audienceId}?fields=approximate_count` +
      `&access_token=${this.accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audience insights`);
    }
    const data = (await response.json()) as Record<string, unknown>;

    return {
      approximateCount: Number(data.approximate_count ?? 0),
    };
  }

  async delete(audienceId: string): Promise<{ success: boolean }> {
    const url = `${this.baseUrl}/${audienceId}?access_token=${this.accessToken}`;
    const response = await fetch(url, { method: "DELETE" });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errorBody.error as Record<string, unknown> | undefined;
      throw new Error(
        `Failed to delete audience: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    return { success: true };
  }

  private mapSourceToSubtype(source: string): string {
    switch (source) {
      case "website":
        return "WEBSITE";
      case "customer_list":
        return "CUSTOM";
      case "engagement":
        return "ENGAGEMENT";
      case "app":
        return "APP";
      case "offline":
        return "CUSTOM";
      default:
        return "CUSTOM";
    }
  }
}
