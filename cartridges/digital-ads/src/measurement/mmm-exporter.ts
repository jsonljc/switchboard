// ---------------------------------------------------------------------------
// MMM Exporter — Export daily-grain data for Marketing Mix Modeling
// ---------------------------------------------------------------------------
// Formats daily insights for Robyn/Meridian input.
// ---------------------------------------------------------------------------

import type { MMMExportData } from "./types.js";

export class MMMExporter {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async export(
    adAccountId: string,
    timeRange: { since: string; until: string },
    format: "csv" | "json" = "json",
  ): Promise<MMMExportData> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const timeRangeParam = encodeURIComponent(
      JSON.stringify({ since: timeRange.since, until: timeRange.until }),
    );

    const url =
      `${this.baseUrl}/${accountId}/insights` +
      `?fields=spend,impressions,clicks,actions,action_values` +
      `&time_range=${timeRangeParam}` +
      `&time_increment=1` +
      `&access_token=${this.accessToken}`;

    const rows = await this.fetchAllPages(url);

    const dailyData = rows.map((row) => {
      const actions = (row.actions ?? []) as Array<{
        action_type: string;
        value: string;
      }>;
      const actionValues = (row.action_values ?? []) as Array<{
        action_type: string;
        value: string;
      }>;

      const conversions = actions
        .filter((a) =>
          ["purchase", "lead", "complete_registration", "offsite_conversion"].includes(
            a.action_type,
          ),
        )
        .reduce((sum, a) => sum + Number(a.value), 0);

      const revenue = actionValues
        .filter((a) => a.action_type === "purchase" || a.action_type === "offsite_conversion")
        .reduce((sum, a) => sum + Number(a.value), 0);

      return {
        date: String(row.date_start ?? ""),
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions,
        revenue,
      };
    });

    return {
      dateRange: timeRange,
      dailyData,
      format,
    };
  }

  private async fetchAllPages(url: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let nextUrl: string | null = url;
    while (nextUrl) {
      const data = await this.fetchJson(nextUrl);
      if (data.data) {
        for (const item of data.data as Record<string, unknown>[]) {
          rows.push(item);
        }
      }
      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }
    return rows;
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
