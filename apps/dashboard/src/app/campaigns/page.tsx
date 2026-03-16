"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignAttribution } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

function formatCurrency(n: number | null): string {
  if (n === null) return "\u2014";
  return `$${n.toFixed(2)}`;
}

function costColor(cost: number | null): string {
  if (cost === null) return "text-zinc-400";
  if (cost < 50) return "text-emerald-400";
  if (cost < 100) return "text-amber-400";
  return "text-red-400";
}

async function fetchCampaignAttribution(): Promise<{ campaigns: CampaignAttribution[] }> {
  const res = await fetch("/api/dashboard/campaign-attribution");
  if (!res.ok) {
    throw new Error("Failed to fetch campaign attribution");
  }
  return (await res.json()) as { campaigns: CampaignAttribution[] };
}

export default function CampaignsPage() {
  const { status } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.campaigns.attribution(),
    queryFn: fetchCampaignAttribution,
    enabled: status === "authenticated",
  });

  if (status === "unauthenticated") redirect("/login");

  const campaigns = data?.campaigns ?? [];

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Campaigns</h1>
        <p className="text-[14px] text-muted-foreground">
          Which campaigns produce real bookings — not just clicks.
        </p>
      </section>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No campaign data yet. Bookings will appear here once leads with campaign attribution are
            tracked.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-surface/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Campaign
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Leads
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Bookings
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Rate
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Spend
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Cost/Booking
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
      )}
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: CampaignAttribution }) {
  const rate = campaign.leads > 0 ? Math.round((campaign.bookings / campaign.leads) * 100) : 0;

  return (
    <tr className="border-b border-border/20 hover:bg-surface/30 transition-colors">
      <td className="px-4 py-3 text-foreground font-medium truncate max-w-[200px]">
        {campaign.campaignId}
      </td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.leads}</td>
      <td className="px-4 py-3 text-right text-foreground font-medium">{campaign.bookings}</td>
      <td className="px-4 py-3 text-right text-muted-foreground">{rate}%</td>
      <td className="px-4 py-3 text-right text-foreground">{formatCurrency(campaign.spend)}</td>
      <td className={`px-4 py-3 text-right font-medium ${costColor(campaign.costPerBooking)}`}>
        {formatCurrency(campaign.costPerBooking)}
      </td>
    </tr>
  );
}
