"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface BundleAgent {
  name: string;
  slug: string;
  roleFocus: RoleFocus;
  roleLabel: string;
}

interface TeamBundleCardProps {
  agents: BundleAgent[];
  stats: { leads: number; callsBooked: number; errors: number };
  className?: string;
}

export function TeamBundleCard({ agents, stats, className }: TeamBundleCardProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15 });

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-surface p-6 sm:p-8 lg:p-10",
        isVisible && "animate-fade-in-up",
        className,
      )}
      style={isVisible ? { animationFillMode: "both" } : { opacity: 0 }}
    >
      <div className="text-center mb-8">
        <h3 className="font-display text-2xl lg:text-3xl font-light text-foreground">
          Sales Pipeline
        </h3>
        <p className="mt-2 text-muted-foreground">
          3 agents, one pipeline. Leads come in, calls get booked.
        </p>
      </div>

      {/* Agent flow */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 lg:gap-8 flex-wrap">
        {agents.map((agent, i) => (
          <div key={agent.slug} className="flex items-center gap-2 sm:gap-4">
            <Link href={`/agents/${agent.slug}`} className="flex flex-col items-center gap-2 group">
              <div className="w-20 h-20">
                <OperatorCharacter roleFocus={agent.roleFocus} className="w-full h-full" />
              </div>
              <span className="text-sm font-medium text-foreground group-hover:underline">
                {agent.name}
              </span>
              <span className="text-xs text-muted-foreground">{agent.roleLabel}</span>
            </Link>
            {i < agents.length - 1 && (
              <span className="text-muted-foreground text-lg shrink-0" aria-hidden="true">
                &rarr;
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Demo label + stats */}
      <div className="mt-8 text-center space-y-2">
        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Demo: Austin Bakery Co
        </p>
        <p className="font-mono text-sm text-muted-foreground tabular-nums">
          last 24h &middot; {stats.leads} leads &middot; {stats.callsBooked} calls booked &middot;{" "}
          {stats.errors} errors
        </p>
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <Button asChild size="lg">
          <Link href="/deploy/sales-pipeline-bundle">Deploy this team</Link>
        </Button>
      </div>
    </div>
  );
}
