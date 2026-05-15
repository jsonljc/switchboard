import type { RecommendationApiRow } from "@/lib/api-client-types";
import type { RileyApprovalView, ApprovalUrgency } from "@/components/cockpit/types";
import { formatRelativeAge } from "@switchboard/core";

interface RileyRecParams {
  campaignId: string;
  urgency: ApprovalUrgency;
  externalUrl?: string;
  breach?: string;
}

const URGENCY_ORDER: Record<ApprovalUrgency, number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

const META_EVENTS_MANAGER_FALLBACK = "https://business.facebook.com/events_manager2/list/pixel/";

export function groupSignalHealthByPixel(rows: RecommendationApiRow[]): RileyApprovalView[] {
  const byPixel = new Map<string, RecommendationApiRow[]>();
  for (const row of rows) {
    const targetEntities = (row.targetEntities ?? {}) as { pixelId?: string };
    const pixelId = targetEntities.pixelId;
    if (!pixelId) continue;
    const params = row.parameters?.__recommendation as RileyRecParams | undefined;
    if (!params?.campaignId?.startsWith("signal:")) continue;
    const list = byPixel.get(pixelId) ?? [];
    list.push(row);
    byPixel.set(pixelId, list);
  }

  const views: RileyApprovalView[] = [];
  for (const [pixelId, group] of byPixel) {
    const urgencies = group
      .map((r) => (r.parameters?.__recommendation as RileyRecParams | undefined)?.urgency)
      .filter((u): u is ApprovalUrgency => !!u);
    const urgency: ApprovalUrgency =
      urgencies.sort((a, b) => URGENCY_ORDER[a] - URGENCY_ORDER[b])[0] ?? "this_week";

    const earliestCreated = group
      .map((r) => new Date(r.createdAt).getTime())
      .reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER);

    const quoteLines = group.map((r) => `• ${r.humanSummary}`).join("\n");

    const externalRow = group.find(
      (r) => (r.parameters?.__recommendation as RileyRecParams | undefined)?.externalUrl,
    );
    const externalUrl =
      (externalRow?.parameters?.__recommendation as RileyRecParams | undefined)?.externalUrl ??
      `${META_EVENTS_MANAGER_FALLBACK}${pixelId}`;

    views.push({
      id: `signal_health_group:${pixelId}`,
      kind: "signal_health_group",
      urgency,
      askedAt: formatRelativeAge(new Date(earliestCreated), new Date(), "UTC"),
      title: `Fix tracking signal — pixel ${pixelId}`,
      quote: quoteLines,
      confidence: 0.9,
      learningPhaseImpact: "no impact",
      reversible: false,
      presentation: {
        primaryLabel: "Open Events Manager",
        dismissLabel: "Decline",
      },
      primary: "Open Events Manager",
      secondary: "Decline",
      primaryAction: { kind: "external", url: externalUrl, service: "meta" },
      campaign: { kind: "account", pixelId, breaches: group.length },
    });
  }

  return views;
}
