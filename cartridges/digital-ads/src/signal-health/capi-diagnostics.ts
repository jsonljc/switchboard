// ---------------------------------------------------------------------------
// CAPI Diagnostics — Server-side event health
// ---------------------------------------------------------------------------

import type { CAPIDiagnostics } from "./types.js";

export class CAPIDiagnosticsChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async diagnose(pixelId: string): Promise<CAPIDiagnostics> {
    const eventsUrl =
      `${this.baseUrl}/${pixelId}/events?fields=` +
      "event_name,event_count,event_source" +
      `&access_token=${this.accessToken}`;

    let serverEvents = 0;
    let browserEvents = 0;
    const eventMap = new Map<string, { server: number; browser: number }>();

    try {
      const data = await this.fetchJson(eventsUrl);
      const events = (data.data ?? []) as Record<string, unknown>[];

      for (const event of events) {
        const name = String(event.event_name ?? "");
        const count = Number(event.event_count ?? 0);
        const source = String(event.event_source ?? "");

        if (!eventMap.has(name)) {
          eventMap.set(name, { server: 0, browser: 0 });
        }
        const entry = eventMap.get(name)!;

        if (source === "server") {
          entry.server += count;
          serverEvents += count;
        } else {
          entry.browser += count;
          browserEvents += count;
        }
      }
    } catch {
      // May fail if CAPI is not configured
    }

    const totalEvents = serverEvents + browserEvents;
    const overallDedup =
      totalEvents > 0
        ? (totalEvents - Math.max(serverEvents, browserEvents)) / totalEvents
        : 0;

    const eventBreakdown = Array.from(eventMap.entries()).map(([name, counts]) => {
      const total = counts.server + counts.browser;
      return {
        eventName: name,
        serverCount: counts.server,
        browserCount: counts.browser,
        deduplicationRate:
          total > 0 ? (total - Math.max(counts.server, counts.browser)) / total : 0,
      };
    });

    const issues: string[] = [];

    if (serverEvents === 0) {
      issues.push("No server-side events detected — CAPI may not be configured");
    } else if (serverEvents < browserEvents * 0.5) {
      issues.push(
        "Server event volume is less than 50% of browser events — CAPI coverage is low",
      );
    }

    if (overallDedup > 0.3) {
      issues.push(
        `High deduplication rate (${(overallDedup * 100).toFixed(1)}%) — check event_id matching`,
      );
    } else if (overallDedup < 0.01 && serverEvents > 0 && browserEvents > 0) {
      issues.push("Very low deduplication — events may not be properly deduplicated");
    }

    return {
      pixelId,
      serverEventsEnabled: serverEvents > 0,
      serverEventsLast24h: serverEvents,
      browserEventsLast24h: browserEvents,
      deduplicationRate: overallDedup,
      eventBreakdown,
      issues,
    };
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(
        `Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
