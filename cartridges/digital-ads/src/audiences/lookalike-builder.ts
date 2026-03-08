// ---------------------------------------------------------------------------
// Lookalike Audience Builder — Lookalike Audience creation with source quality validation
// ---------------------------------------------------------------------------

import type { CreateLookalikeParams, CustomAudienceInfo } from "./types.js";

export class LookalikeBuilder {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async create(params: CreateLookalikeParams): Promise<CustomAudienceInfo> {
    // Validate source audience
    const sourceUrl =
      `${this.baseUrl}/${params.sourceAudienceId}?fields=` +
      "id,name,approximate_count,delivery_status" +
      `&access_token=${this.accessToken}`;

    const sourceResponse = await fetch(sourceUrl);
    if (!sourceResponse.ok) {
      throw new Error(`Source audience ${params.sourceAudienceId} not found or inaccessible`);
    }
    const sourceData = (await sourceResponse.json()) as Record<string, unknown>;
    const sourceCount = Number(sourceData.approximate_count ?? 0);

    if (sourceCount < 100) {
      throw new Error(
        `Source audience too small (${sourceCount} users). Minimum 100 required for lookalikes.`,
      );
    }

    // Validate ratio
    if (params.ratio < 0.01 || params.ratio > 0.2) {
      throw new Error(
        `Lookalike ratio must be between 0.01 (1%) and 0.20 (20%). Got: ${params.ratio}`,
      );
    }

    const accountId = params.adAccountId.startsWith("act_")
      ? params.adAccountId
      : `act_${params.adAccountId}`;

    const url = `${this.baseUrl}/${accountId}/customaudiences?access_token=${this.accessToken}`;
    const body = {
      name: params.name,
      description:
        params.description ?? `Lookalike of ${sourceData.name ?? params.sourceAudienceId}`,
      subtype: "LOOKALIKE",
      origin_audience_id: params.sourceAudienceId,
      lookalike_spec: JSON.stringify({
        type: "similarity",
        country: params.targetCountries.join(","),
        ratio: params.ratio,
      }),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errorBody.error as Record<string, unknown> | undefined;
      throw new Error(
        `Failed to create lookalike audience: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      id: String(data.id),
      name: params.name,
      description: params.description ?? null,
      subtype: "LOOKALIKE",
      approximateCount: null,
      deliveryStatus: null,
      retentionDays: null,
      createdAt: new Date().toISOString(),
    };
  }
}
