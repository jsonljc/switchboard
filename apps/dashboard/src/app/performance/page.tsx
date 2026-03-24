"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { ResultsContent } from "@/components/performance/results-content.js";
import { GrowthContent } from "@/components/performance/growth-content.js";

type PerfTab = "results" | "growth";

export default function PerformancePage() {
  const { status } = useSession();
  const [tab, setTab] = useState<PerfTab>("results");

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Performance</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Your results and growth metrics.
        </p>
      </section>

      <div className="flex items-center gap-0 border-b border-border/60">
        {(["results", "growth"] as PerfTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap capitalize",
              tab === t
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === "results" ? <ResultsContent /> : <GrowthContent />}
    </div>
  );
}
