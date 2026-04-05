"use client";

import { useEffect, useState } from "react";

interface StatCardProps {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  description: string;
  animate: boolean;
}

export function StatCard({ value, prefix, suffix, label, description, animate }: StatCardProps) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (!animate) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplayed(value);
      return;
    }

    const duration = 800;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * value));
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }, [animate, value]);

  return (
    <div className="text-center">
      <div className="font-mono text-4xl lg:text-5xl font-bold text-foreground">
        {prefix}
        {displayed}
        {suffix}
      </div>
      <div className="mt-1 text-sm font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
