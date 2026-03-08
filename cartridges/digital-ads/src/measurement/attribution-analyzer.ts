// ---------------------------------------------------------------------------
// Attribution Analyzer — Compare conversions across attribution windows
// ---------------------------------------------------------------------------

import type { AttributionComparison } from "./types.js";

export class AttributionAnalyzer {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async compare(adAccountId: string, datePreset?: string): Promise<AttributionComparison[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const preset = datePreset ?? "last_30d";
    const url =
      `${this.baseUrl}/${accountId}/insights` +
      `?fields=spend,actions,cost_per_action_type` +
      `&date_preset=${preset}` +
      `&action_attribution_windows=["1d_click","7d_click","1d_view"]` +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const rows = (data.data ?? []) as Record<string, unknown>[];

    if (rows.length === 0) {
      return [];
    }

    // Build comparisons from the aggregated row
    const row = rows[0]!;
    const spend = Number(row.spend ?? 0);
    const actions = (row.actions ?? []) as Array<{
      action_type: string;
      value: string;
      "1d_click"?: string;
      "7d_click"?: string;
      "1d_view"?: string;
    }>;

    const conversionTypes = ["purchase", "lead", "complete_registration", "offsite_conversion"];
    const comparisons: AttributionComparison[] = [];

    for (const convType of conversionTypes) {
      const action = actions.find((a) => a.action_type === convType);
      if (!action) continue;

      const windows: AttributionComparison["windows"] = [];

      const click1d = Number(action["1d_click"] ?? 0);
      const click7d = Number(action["7d_click"] ?? 0);
      const view1d = Number(action["1d_view"] ?? 0);

      if (click1d > 0) {
        windows.push({
          window: "1d_click",
          conversions: click1d,
          costPerConversion: click1d > 0 ? spend / click1d : null,
        });
      }
      if (click7d > 0) {
        windows.push({
          window: "7d_click",
          conversions: click7d,
          costPerConversion: click7d > 0 ? spend / click7d : null,
        });
      }
      if (view1d > 0) {
        windows.push({
          window: "1d_view",
          conversions: view1d,
          costPerConversion: view1d > 0 ? spend / view1d : null,
        });
      }

      if (windows.length > 0) {
        comparisons.push({
          metric: convType,
          windows,
        });
      }
    }

    return comparisons;
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
