"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical } from "lucide-react";

interface SimulatePreviewProps {
  principalId: string;
}

interface SimulateResult {
  decision: string;
  riskScore: { rawScore: number; category: string };
}

const decisionBadgeVariant = (decision: string) => {
  if (decision === "allow" || decision === "execute") return "default" as const;
  if (decision === "deny" || decision === "block") return "destructive" as const;
  return "secondary" as const;
};

const decisionLabel = (decision: string) => {
  if (decision === "allow" || decision === "execute") return "Allowed";
  if (decision === "deny" || decision === "block") return "Denied";
  if (decision === "require_approval") return "Requires Approval";
  return decision;
};

export function SimulatePreview({ principalId }: SimulatePreviewProps) {
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "setBudget",
          parameters: { amount: 50, currency: "USD" },
          principalId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Simulation failed");
      }
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Preview Changes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Test how your current settings would handle a sample action.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={runSimulation}
          disabled={isLoading}
        >
          {isLoading ? "Simulating..." : "Run Simulation"}
        </Button>
        {isLoading && <Skeleton className="h-16" />}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {result && !isLoading && (
          <div className="p-3 bg-muted rounded-md space-y-2">
            <p className="text-sm">
              With these settings, a <strong>$50 budget change</strong> would be:
            </p>
            <div className="flex items-center gap-2">
              <Badge variant={decisionBadgeVariant(result.decision)}>
                {decisionLabel(result.decision)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Risk: {result.riskScore.category} ({Math.round(result.riskScore.rawScore * 100)}%)
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
