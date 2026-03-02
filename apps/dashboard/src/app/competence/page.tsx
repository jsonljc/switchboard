"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useCompetenceRecords, useCompetencePolicies } from "@/hooks/use-competence";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

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
  const { status } = useSession();
  const [principalFilter, setPrincipalFilter] = useState("");

  if (status === "unauthenticated") redirect("/login");
  const { data: records = [], isLoading, isError, error, refetch } = useCompetenceRecords(
    principalFilter || undefined,
  );
  const { data: policies = [] } = useCompetencePolicies();

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Competence Tracking</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load competence data</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Competence Tracking</h1>
        <p className="text-muted-foreground">
          View agent competence scores and manage competence policies.
        </p>
      </div>

      <div className="flex gap-4">
        <Input
          type="text"
          placeholder="Filter by principal ID..."
          value={principalFilter}
          onChange={(e) => setPrincipalFilter(e.target.value)}
          className="w-64"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-4">Competence Records</h2>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
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
