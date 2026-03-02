"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface TokenUsageCardProps {
  title: string;
  tokens: number;
  budget: number | null;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function TokenUsageCard({ title, tokens, budget }: TokenUsageCardProps) {
  const percentage = budget ? Math.min((tokens / budget) * 100, 100) : 0;
  const isOverBudget = budget ? tokens > budget : false;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatTokens(tokens)}</div>
        {budget != null && (
          <>
            <Progress
              value={percentage}
              className={`mt-2 h-2 ${isOverBudget ? "[&>div]:bg-destructive" : ""}`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {formatTokens(tokens)} / {formatTokens(budget)} tokens
              {isOverBudget && (
                <span className="ml-1 text-destructive font-medium">Over budget</span>
              )}
            </p>
          </>
        )}
        {budget == null && (
          <p className="mt-1 text-xs text-muted-foreground">No budget set</p>
        )}
      </CardContent>
    </Card>
  );
}
