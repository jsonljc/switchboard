// ---------------------------------------------------------------------------
// Lift Study Manager — Create and check conversion lift studies
// ---------------------------------------------------------------------------

import type { LiftStudy } from "./types.js";

export class LiftStudyManager {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async create(
    adAccountId: string,
    params: {
      name: string;
      startTime: number;
      endTime: number;
      cells: Array<{
        name: string;
        adSetIds?: string[];
        campaignIds?: string[];
      }>;
    },
  ): Promise<LiftStudy> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const url = `${this.baseUrl}/${accountId}/ad_studies` + `?access_token=${this.accessToken}`;

    const body = {
      name: params.name,
      type: "LIFT",
      start_time: params.startTime,
      end_time: params.endTime,
      cells: params.cells.map((cell) => ({
        name: cell.name,
        adsets: cell.adSetIds,
        campaigns: cell.campaignIds,
      })),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = errBody.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    return {
      id: String(result.id),
      name: params.name,
      status: "CREATED",
      type: "LIFT",
      startTime: new Date(params.startTime * 1000).toISOString(),
      endTime: new Date(params.endTime * 1000).toISOString(),
      results: null,
    };
  }

  async check(studyId: string): Promise<LiftStudy> {
    const url =
      `${this.baseUrl}/${studyId}` +
      `?fields=id,name,status,type,start_time,end_time,results,confidence_level` +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);

    const resultsData = data.results as Record<string, unknown> | undefined;
    let results: LiftStudy["results"] = null;
    if (resultsData) {
      results = {
        confidenceLevel:
          resultsData.confidence_level != null
            ? Number(resultsData.confidence_level)
            : data.confidence_level != null
              ? Number(data.confidence_level)
              : null,
        incrementalConversions:
          resultsData.incremental_conversions != null
            ? Number(resultsData.incremental_conversions)
            : null,
        incrementalCostPerConversion:
          resultsData.incremental_cost_per_conversion != null
            ? Number(resultsData.incremental_cost_per_conversion)
            : null,
        liftPercent: resultsData.lift_percent != null ? Number(resultsData.lift_percent) : null,
      };
    }

    return {
      id: String(data.id),
      name: String(data.name ?? ""),
      status: String(data.status ?? ""),
      type: String(data.type ?? "LIFT"),
      startTime: (data.start_time as string) ?? null,
      endTime: (data.end_time as string) ?? null,
      results,
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
