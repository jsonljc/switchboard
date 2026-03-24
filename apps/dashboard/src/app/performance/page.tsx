"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { ResultsContent } from "@/components/performance/results-content";
import { GrowthContent } from "@/components/performance/growth-content";
import { CampaignsContent } from "@/components/performance/campaigns-content";

type PerfTab = "results" | "growth" | "campaigns";

const TABS: { key: PerfTab; label: string }[] = [
  { key: "results", label: "Results" },
  { key: "growth", label: "Growth" },
  { key: "campaigns", label: "Campaigns" },
];

export default function PerformancePage() {
  const { status } = useSession();
  const [tab, setTab] = useState<PerfTab>("results");

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Performance</h1>
        <p className="text-[14px] text-muted-foreground mt-1">Your results and growth metrics.</p>
      </section>

      <div className="flex items-center gap-0 border-b border-border/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap",
              tab === t.key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === "results" && <ResultsContent />}
      {tab === "growth" && <GrowthContent />}
      {tab === "campaigns" && <CampaignsContent />}
    </div>
  );
}
