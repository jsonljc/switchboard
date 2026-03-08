// ---------------------------------------------------------------------------
// Pixel Diagnostics — Pixel event validation
// ---------------------------------------------------------------------------

import type { PixelDiagnostics } from "./types.js";

export class PixelDiagnosticsChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async diagnose(adAccountId: string): Promise<PixelDiagnostics[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const pixelsUrl =
      `${this.baseUrl}/${accountId}/adspixels?fields=` +
      "id,name,is_unavailable,last_fired_time" +
      `&access_token=${this.accessToken}`;

    const pixelsData = await this.fetchJson(pixelsUrl);
    const pixels = (pixelsData.data ?? []) as Record<string, unknown>[];

    const results: PixelDiagnostics[] = [];

    for (const pixel of pixels) {
      const pixelId = String(pixel.id);

      const statsUrl =
        `${this.baseUrl}/${pixelId}/stats?aggregation=event` + `&access_token=${this.accessToken}`;

      let eventBreakdown: PixelDiagnostics["eventBreakdown"] = [];
      let totalEvents = 0;

      try {
        const statsData = await this.fetchJson(statsUrl);
        const stats = (statsData.data ?? []) as Record<string, unknown>[];
        eventBreakdown = stats.map((s) => {
          const count = Number(s.count ?? 0);
          totalEvents += count;
          return {
            eventName: String(s.event ?? ""),
            count,
            lastFired: (s.last_fired_time as string) ?? null,
          };
        });
      } catch {
        // Stats may fail for inactive pixels
      }

      const issues: string[] = [];
      const isActive = !pixel.is_unavailable;

      if (!isActive) {
        issues.push("Pixel is marked as unavailable");
      }
      if (totalEvents === 0) {
        issues.push("No events received in the last 24 hours");
      }
      if (!pixel.last_fired_time) {
        issues.push("Pixel has never fired");
      }

      const standardEvents = ["PageView", "Purchase", "AddToCart", "InitiateCheckout", "Lead"];
      const receivedEvents = new Set(eventBreakdown.map((e) => e.eventName));
      for (const event of standardEvents) {
        if (!receivedEvents.has(event) && totalEvents > 0) {
          issues.push(`Missing standard event: ${event}`);
        }
      }

      results.push({
        pixelId,
        pixelName: String(pixel.name ?? ""),
        isActive,
        lastFiredTime: (pixel.last_fired_time as string) ?? null,
        totalEventsLast24h: totalEvents,
        eventBreakdown,
        issues,
      });
    }

    return results;
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
