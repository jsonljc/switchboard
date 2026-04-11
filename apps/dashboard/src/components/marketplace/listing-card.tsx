"use client";

import Link from "next/link";
import { Bot, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TrustScoreBadge } from "./trust-score-badge";
import type { MarketplaceListing } from "@/lib/api-client";

const TYPE_ICON = {
  switchboard_native: Bot,
  third_party: ExternalLink,
  open_source: ExternalLink,
} as const;

const PRICE_LABELS: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  elite: "Elite",
};

export function ListingCard({ listing }: { listing: MarketplaceListing }) {
  const Icon = TYPE_ICON[listing.type as keyof typeof TYPE_ICON] ?? Bot;

  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className="block rounded-xl border border-border bg-surface p-6 space-y-4 hover:border-border/80 hover:bg-surface-raised transition-colors duration-fast"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-foreground leading-snug">{listing.name}</h3>
            <p className="text-[12px] text-muted-foreground capitalize">
              {listing.type.replace(/_/g, " ")}
            </p>
          </div>
        </div>
        <TrustScoreBadge score={listing.trustScore} />
      </div>

      <p className="text-[13.5px] text-muted-foreground leading-relaxed line-clamp-2">
        {listing.description}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {listing.taskCategories.slice(0, 3).map((cat) => (
            <Badge key={cat} variant="secondary" className="text-[11px] font-normal">
              {cat}
            </Badge>
          ))}
          {listing.taskCategories.length > 3 && (
            <Badge variant="secondary" className="text-[11px] font-normal">
              +{listing.taskCategories.length - 3}
            </Badge>
          )}
        </div>
        <span className="text-[12px] text-muted-foreground shrink-0">
          {PRICE_LABELS[listing.priceTier] ?? listing.priceTier}
          {listing.priceMonthly > 0 && ` · $${listing.priceMonthly}/mo`}
        </span>
      </div>

      <div className="flex justify-end">
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(`/deploy/${listing.slug}`)}`}
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={(e) => e.stopPropagation()}
        >
          Deploy
        </Link>
      </div>
    </Link>
  );
}
