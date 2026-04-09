"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { TrustBar } from "@/components/marketplace/trust-bar";
import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface AgentMarketplaceCardProps {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
  autonomyLevel: string;
  roleFocus: RoleFocus;
  bundleSlug: string;
  stats: {
    totalTasks: number;
    approvalRate: number;
    lastActiveAt: string | null;
  };
  className?: string;
  animationDelay?: number;
}

export function AgentMarketplaceCard({
  name,
  slug,
  description,
  trustScore,
  autonomyLevel,
  roleFocus,
  bundleSlug,
  stats,
  className,
  animationDelay = 0,
}: AgentMarketplaceCardProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1 });

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-surface p-6 flex flex-col",
        "transition-shadow hover:shadow-md",
        isVisible && "animate-fade-in-up",
        className,
      )}
      style={
        isVisible
          ? { animationDelay: `${animationDelay}ms`, animationFillMode: "both" }
          : { opacity: 0 }
      }
    >
      {/* Character */}
      <div className="flex justify-center mb-4">
        <div className="w-28 h-28">
          <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
        </div>
      </div>

      {/* Name */}
      <h3 className="font-display text-xl font-medium text-foreground text-center">{name}</h3>

      {/* Trust score */}
      <div className="flex justify-center mt-3">
        <TrustBar score={trustScore} />
      </div>

      {/* Autonomy badge */}
      <div className="flex justify-center mt-2">
        <span className="text-xs font-mono text-muted-foreground border border-border px-2 py-0.5 rounded">
          {autonomyLevel}
        </span>
      </div>

      {/* Description */}
      <p className="mt-4 text-sm text-muted-foreground text-center line-clamp-2">{description}</p>

      {/* Divider */}
      <div className="border-t border-border-subtle my-4" />

      {/* Today stats */}
      <div className="space-y-1.5">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          today
        </span>
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-mono tabular-nums">{stats.totalTasks}</span>
            <span className="text-muted-foreground"> tasks</span>
          </p>
          <p>
            <span className="font-mono tabular-nums">{stats.approvalRate}%</span>
            <span className="text-muted-foreground"> approved</span>
          </p>
          <p className="text-muted-foreground">
            last active{" "}
            <span className="font-mono tabular-nums">{formatTimeAgo(stats.lastActiveAt)}</span>
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border-subtle my-4" />

      {/* Actions */}
      <div className="flex items-center justify-between mt-auto">
        <Button asChild size="sm">
          <Link href={`/deploy/${bundleSlug}`}>Hire</Link>
        </Button>
        <Link
          href={`/agents/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          See work &rarr;
        </Link>
      </div>
    </div>
  );
}
