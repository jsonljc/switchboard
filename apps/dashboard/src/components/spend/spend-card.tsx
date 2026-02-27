"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from "@/lib/utils";

interface SpendCardProps {
  title: string;
  spent: number;
  limit: number | null;
}

export function SpendCard({ title, spent, limit }: SpendCardProps) {
  const percentage = limit ? Math.min((spent / limit) * 100, 100) : 0;
  const isOverBudget = limit ? spent > limit : false;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatCurrency(spent)}</div>
        {limit != null && (
          <>
            <Progress
              value={percentage}
              className={`mt-2 h-2 ${isOverBudget ? "[&>div]:bg-destructive" : ""}`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCurrency(spent)} / {formatCurrency(limit)}
              {isOverBudget && (
                <span className="ml-1 text-destructive font-medium">Over limit</span>
              )}
            </p>
          </>
        )}
        {limit == null && (
          <p className="mt-1 text-xs text-muted-foreground">No limit set</p>
        )}
      </CardContent>
    </Card>
  );
}
