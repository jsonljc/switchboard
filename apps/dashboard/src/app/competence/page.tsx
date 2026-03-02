"use client";

import { useState } from "react";
import { useCompetenceRecords, useCompetencePolicies } from "@/hooks/use-competence";
import { cn } from "@/lib/utils";

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function CompetencePage() {
  const [principalFilter, setPrincipalFilter] = useState("");
  const { data: records = [], isLoading } = useCompetenceRecords(
    principalFilter || undefined,
  );
  const { data: policies = [] } = useCompetencePolicies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Competence Tracking</h1>
        <p className="text-muted-foreground">
          View agent competence scores and manage competence policies.
        </p>
      </div>

      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Filter by principal ID..."
          value={principalFilter}
          onChange={(e) => setPrincipalFilter(e.target.value)}
          className="px-3 py-2 border rounded-md text-sm w-64"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-4">Competence Records</h2>
          {isLoading ? (
            <div className="text-muted-foreground text-center py-8">Loading...</div>
          ) : records.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">No records found.</div>
          ) : (
            <div className="space-y-3">
              {records.map((record: any, i: number) => (
                <div key={i} className="border rounded-md p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-mono text-xs">{record.principalId}</span>
                    <span className="text-muted-foreground">
                      {record.successfulAttempts}/{record.totalAttempts} attempts
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{record.actionType}</div>
                  <ScoreBar score={record.score} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-4">Competence Policies</h2>
          {policies.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">No policies configured.</div>
          ) : (
            <div className="space-y-3">
              {policies.map((policy: any) => (
                <div key={policy.id} className="border rounded-md p-3">
                  <div className="flex justify-between">
                    <span className="font-mono text-sm">{policy.actionTypePattern}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      policy.effect === "deny" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700",
                    )}>
                      {policy.effect}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Min score: {Math.round(policy.minScore * 100)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
