"use client";

import { StatCard } from "./stat-card";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

const STATS = [
  {
    value: 60,
    prefix: "< ",
    suffix: "s",
    label: "response time",
    description: "Agents act immediately on every trigger.",
  },
  {
    value: 100,
    suffix: "%",
    label: "follow-through",
    description: "Nothing falls through the cracks.",
  },
  {
    value: 4,
    label: "trust levels",
    description: "Supervised → Guided → Autonomous → Autonomous+. Earned, not assigned.",
  },
];

export function StatsSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-20 lg:py-28 bg-surface-raised" aria-label="Platform stats">
      <div className="page-width" ref={ref}>
        <h2 className="font-display text-3xl lg:text-4xl font-light text-center text-foreground mb-16">
          How Switchboard agents work
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 lg:gap-16">
          {STATS.map((stat) => (
            <StatCard key={stat.label} {...stat} animate={isVisible} />
          ))}
        </div>

        <p className="mt-16 text-center text-sm text-muted-foreground max-w-lg mx-auto">
          These aren&apos;t vanity metrics. They&apos;re operational guarantees. The agents
          don&apos;t forget, don&apos;t sleep, don&apos;t get busy with another client.
        </p>
      </div>
    </section>
  );
}
