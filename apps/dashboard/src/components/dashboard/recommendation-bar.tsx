"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { pickRecommendation } from "@/lib/recommendation-logic";
import type { ModuleStatus } from "@/lib/module-types";

interface RecommendationBarProps {
  modules: ModuleStatus[];
}

export function RecommendationBar({ modules }: RecommendationBarProps) {
  const rec = pickRecommendation(modules);

  const isSuccess = rec.type === "all_live";
  const isError = rec.type === "fix";

  return (
    <Link
      href={rec.href}
      className={cn(
        "flex items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors",
        isSuccess && "bg-success/5 text-success hover:bg-success/10",
        isError && "bg-destructive/5 text-destructive hover:bg-destructive/10",
        !isSuccess && !isError && "bg-muted/50 text-foreground hover:bg-muted",
      )}
    >
      <span>{rec.message}</span>
      <span className="ml-2 shrink-0">&rarr;</span>
    </Link>
  );
}
