"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft, Bot, ExternalLink, Rocket } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListing, useTrustScore, useDeployments } from "@/hooks/use-marketplace";
import { TrustScoreBadge } from "@/components/marketplace/trust-score-badge";

const PRICE_LABELS: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  elite: "Elite",
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const router = useRouter();
  const { data: listing, isLoading: listingLoading } = useListing(id);
  const { data: trustData, isLoading: trustLoading } = useTrustScore(id);
  const { data: deployments } = useDeployments();

  if (status === "unauthenticated") redirect("/login");

  const isDeployed = deployments?.some((d) => d.listingId === id) ?? false;

  if (status === "loading" || listingLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] text-foreground font-medium">Agent not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push("/marketplace")}>
          Back to marketplace
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push("/marketplace")}
        aria-label="Back to marketplace"
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-fast"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Marketplace
      </button>

      {/* Header */}
      <section className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Bot className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
              {listing.name}
            </h1>
            <p className="text-[13px] text-muted-foreground capitalize mt-0.5">
              {listing.type.replace(/_/g, " ")}
              {listing.sourceUrl && (
                <>
                  {" · "}
                  <a
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {isDeployed ? (
            <Badge variant="secondary" className="text-[12px]">
              Deployed
            </Badge>
          ) : (
            <Button onClick={() => router.push(`/marketplace/${id}/deploy`)}>
              <Rocket className="h-4 w-4 mr-1.5" />
              Deploy
            </Button>
          )}
        </div>
      </section>

      {/* Description */}
      <section>
        <p className="text-[14.5px] text-foreground leading-relaxed">{listing.description}</p>
      </section>

      {/* Trust Score */}
      <section>
        <h2 className="section-label mb-4">Trust Score</h2>
        <div className="rounded-xl border border-border bg-surface p-6">
          <TrustScoreBadge score={listing.trustScore} size="lg" />

          {trustLoading ? (
            <Skeleton className="h-20 mt-4" />
          ) : trustData?.breakdown && trustData.breakdown.length > 0 ? (
            <div className="mt-6 space-y-3">
              <p className="section-label">Per-category breakdown</p>
              {trustData.breakdown.map((item) => (
                <div
                  key={item.taskCategory}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                >
                  <div>
                    <p className="text-[14px] text-foreground capitalize">{item.taskCategory}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {item.totalApprovals} approved · {item.totalRejections} rejected
                      {item.consecutiveApprovals > 0 && ` · ${item.consecutiveApprovals} streak`}
                    </p>
                  </div>
                  <TrustScoreBadge score={item.score} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground mt-4">
              No task history yet. Deploy this agent to start building trust.
            </p>
          )}
        </div>
      </section>

      {/* Categories & Pricing */}
      <section className="flex gap-8">
        <div className="flex-1">
          <h2 className="section-label mb-3">Task Categories</h2>
          <div className="flex flex-wrap gap-1.5">
            {listing.taskCategories.map((cat) => (
              <Badge key={cat} variant="secondary" className="text-[12px] capitalize">
                {cat}
              </Badge>
            ))}
          </div>
        </div>
        <div className="shrink-0">
          <h2 className="section-label mb-3">Pricing</h2>
          <p className="text-[15px] font-medium text-foreground">
            {PRICE_LABELS[listing.priceTier] ?? listing.priceTier}
            {listing.priceMonthly > 0 && (
              <span className="text-muted-foreground font-normal">
                {" "}
                · ${listing.priceMonthly}/mo
              </span>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
