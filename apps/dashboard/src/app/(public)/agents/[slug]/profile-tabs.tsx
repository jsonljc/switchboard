"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { TrustHistoryChart } from "@/components/marketplace/trust-history-chart";

interface ProfileTabsProps {
  tasks: Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    output: Record<string, unknown> | null;
  }>;
  stats: {
    totalTasks: number;
    approvedCount: number;
    approvalRate: number;
    lastActiveAt: string | null;
  };
  trustProgression: Array<{ timestamp: string; score: number }>;
  trustBreakdown: {
    totalApprovals: number;
    totalRejections: number;
    currentStreak: number;
    highestScore: number;
  };
  agentSlug: string;
  bundleSlug: string;
}

const TABS = ["Overview", "Work log", "Trust history"] as const;
type Tab = (typeof TABS)[number];

const AGENT_WORKFLOWS: Record<string, string[]> = {
  "speed-to-lead": [
    "Lead fills out a form or sends a message",
    "Agent qualifies through natural conversation",
    "Qualified \u2192 hands to Sales Closer",
    "Not ready \u2192 hands to Nurture Specialist",
  ],
  "sales-closer": [
    "Receives qualified lead with full context",
    "Handles objections and builds urgency",
    "Books a call or consultation",
    "Complex negotiation \u2192 escalates to human",
  ],
  "nurture-specialist": [
    "Receives leads that aren't ready to buy",
    "Schedules follow-ups across a cadence",
    "Varies approach based on previous interactions",
    "Lead re-engages \u2192 hands to Sales Closer",
  ],
};

export function AgentProfileTabs({
  tasks,
  stats,
  trustProgression,
  trustBreakdown,
  agentSlug,
  bundleSlug: _bundleSlug,
}: ProfileTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
              activeTab === tab
                ? "text-foreground border-b-2 border-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="py-6" role="tabpanel">
        {activeTab === "Overview" && (
          <div className="space-y-8">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Tasks completed", value: stats.totalTasks },
                { label: "Approval rate", value: `${stats.approvalRate}%` },
                { label: "Response time", value: "< 60s" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <p className="font-mono text-2xl tabular-nums">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Team context */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Part of:{" "}
                <a href="/" className="text-foreground hover:underline">
                  Sales Pipeline team
                </a>
              </p>
              <p className="text-sm text-muted-foreground">
                Works with:{" "}
                {["speed-to-lead", "sales-closer", "nurture-specialist"]
                  .filter((s) => s !== agentSlug)
                  .map((s, i, arr) => (
                    <span key={s}>
                      <a href={`/agents/${s}`} className="text-foreground hover:underline">
                        {s
                          .split("-")
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(" ")}
                      </a>
                      {i < arr.length - 1 ? ", " : ""}
                    </span>
                  ))}
              </p>
            </div>

            {/* How it works */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">How it works</h3>
              <ol className="space-y-2">
                {(AGENT_WORKFLOWS[agentSlug] ?? []).map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="font-mono text-muted-foreground shrink-0">{i + 1}.</span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {activeTab === "Work log" && <WorkLogList tasks={tasks} />}

        {activeTab === "Trust history" && (
          <TrustHistoryChart
            data={trustProgression}
            totalApprovals={trustBreakdown.totalApprovals}
            totalRejections={trustBreakdown.totalRejections}
            currentStreak={trustBreakdown.currentStreak}
            highestScore={trustBreakdown.highestScore}
          />
        )}
      </div>
    </div>
  );
}
