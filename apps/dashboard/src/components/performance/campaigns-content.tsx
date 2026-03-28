"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignAttribution } from "@/lib/api-client-types";
import { queryKeys } from "@/lib/query-keys";

function formatCurrency(n: number | null): string {
  if (n === null) return "\u2014";
  return `$${n.toFixed(2)}`;
}

function roasColor(roas: number | null): string {
  if (roas === null) return "text-muted-foreground";
  if (roas >= 3) return "text-positive";
  if (roas >= 1) return "text-caution";
  return "text-destructive";
}

async function fetchCampaignAttribution(): Promise<{ campaigns: CampaignAttribution[] }> {
  const res = await fetch("/api/dashboard/campaign-attribution");
  if (!res.ok) {
    throw new Error("Failed to fetch campaign attribution");
  }
  return (await res.json()) as { campaigns: CampaignAttribution[] };
}

function CampaignRow({ campaign }: { campaign: CampaignAttribution }) {
  return (
    <tr className="border-b border-border/20 hover:bg-surface/30 transition-colors">
      <td className="px-4 py-3 text-foreground font-medium truncate max-w-[200px]">
        {campaign.name}
      </td>
      <td className="px-4 py-3 text-right text-foreground">{formatCurrency(campaign.spend)}</td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.leads}</td>
      <td className="px-4 py-3 text-right text-foreground font-medium">{campaign.bookings}</td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.paid}</td>
      <td className="px-4 py-3 text-right text-positive font-medium">
        {formatCurrency(campaign.revenue)}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${roasColor(campaign.roas)}`}>
        {campaign.roas !== null ? `${campaign.roas.toFixed(1)}x` : "\u2014"}
      </td>
    </tr>
  );
}

export function CampaignsContent() {
  const { status } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.campaigns.attribution(),
    queryFn: fetchCampaignAttribution,
    enabled: status === "authenticated",
  });

  const campaigns = data?.campaigns ?? [];

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-surface p-8 text-center mt-4">
        <p className="text-muted-foreground text-sm">
          No campaign data yet. Bookings will appear here once leads with campaign attribution are
          tracked.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 bg-surface/50">
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Campaign
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Spend
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Leads
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Bookings
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Paid
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Revenue
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              ROAS
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c: CampaignAttribution) => (
            <CampaignRow key={c.campaignId} campaign={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
