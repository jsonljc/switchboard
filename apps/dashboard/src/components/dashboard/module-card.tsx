"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ModuleStatus, ModuleState } from "@/lib/module-types";

const STATE_BADGE: Record<ModuleState, { text: string; className: string }> = {
  connection_broken: {
    text: "Attention needed",
    className: "bg-destructive/10 text-destructive",
  },
  needs_connection: {
    text: "Needs connection",
    className: "bg-caution/10 text-caution-foreground",
  },
  partial_setup: {
    text: "Continue setup",
    className: "bg-caution/10 text-caution-foreground",
  },
  not_setup: {
    text: "Not set up",
    className: "bg-muted text-muted-foreground",
  },
  live: {
    text: "Live",
    className: "bg-success/10 text-success",
  },
};

interface ModuleCardProps {
  module: ModuleStatus;
}

export function ModuleCard({ module }: ModuleCardProps) {
  const badge = STATE_BADGE[module.state];
  const href = module.cta.href;
  const isDisabled = module.isPlatformBlocking;

  return (
    <Link
      href={isDisabled ? "#" : href}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-5 transition-all duration-200",
        !isDisabled && "hover:border-foreground/20 hover:shadow-sm",
        isDisabled && "opacity-60 cursor-not-allowed",
      )}
      onClick={isDisabled ? (e) => e.preventDefault() : undefined}
    >
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {module.label}
        </h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badge.className)}>
          {badge.text}
        </span>
      </div>

      <p className="text-sm text-muted-foreground leading-snug">{module.subtext}</p>

      {module.setupProgress && module.state !== "live" && (
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-foreground/30 transition-all"
            style={{ width: `${(module.setupProgress.done / module.setupProgress.total) * 100}%` }}
          />
        </div>
      )}

      <div className="mt-auto pt-1">
        <span
          className={cn(
            "inline-flex items-center text-xs font-medium transition-colors",
            module.state === "connection_broken"
              ? "text-destructive"
              : module.state === "live"
                ? "text-muted-foreground group-hover:text-foreground"
                : "text-foreground",
          )}
        >
          {isDisabled ? "Contact administrator" : module.cta.label}
          {!isDisabled && (
            <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span>
          )}
        </span>
      </div>
    </Link>
  );
}
