"use client";

import { TrustCard } from "./trust-card";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { cn } from "@/lib/utils";

function PixelProgressBar() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-3 h-4 rounded-sm border",
              i === 0 ? "bg-foreground border-foreground" : "bg-transparent border-border",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-sm font-bold text-foreground">0</span>
    </div>
  );
}

function PixelCheckmarks() {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="w-6 h-6 rounded border-2 border-positive bg-positive-subtle flex items-center justify-center"
        >
          <span className="text-positive text-xs font-bold">&check;</span>
        </div>
      ))}
    </div>
  );
}

function PixelShield() {
  return (
    <div className="w-8 h-9 rounded border-2 border-foreground flex items-center justify-center">
      <span className="text-foreground text-sm font-bold">&hearts;</span>
    </div>
  );
}

export function TrustSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-20 lg:py-28" aria-label="Trust and governance">
      <div className="page-width" ref={ref}>
        <h2 className="font-display text-3xl lg:text-4xl font-light text-center text-foreground mb-12">
          You&apos;re the boss. Literally.
        </h2>

        <div
          className={cn(
            "grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto",
            isVisible && "animate-fade-in-up",
          )}
          style={isVisible ? { animationFillMode: "both" } : { opacity: 0 }}
        >
          <TrustCard
            visual={<PixelProgressBar />}
            text="Every agent starts at zero trust. No exceptions."
          />
          <TrustCard
            visual={<PixelCheckmarks />}
            text="New agents need your OK on every task. Earn autonomy over time."
          />
          <TrustCard
            visual={<PixelShield />}
            text="They never claim to be human. Never promise what you can't deliver."
          />
        </div>
      </div>
    </section>
  );
}
