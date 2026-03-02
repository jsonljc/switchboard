"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AlertHistoryEntry } from "@/lib/api-client";

interface AlertHistoryListProps {
  history: AlertHistoryEntry[];
  isLoading?: boolean;
}

export function AlertHistoryList({ history, isLoading }: AlertHistoryListProps) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading history...</p>;
  }

  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No alert history yet.</p>;
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => (
        <Card key={entry.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {new Date(entry.triggeredAt).toLocaleString()}
              </CardTitle>
              <Badge variant="destructive">Triggered</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <p>
                Value: <span className="font-mono font-semibold">{entry.metricValue}</span>{" "}
                (threshold: {entry.threshold})
              </p>
              <p className="text-muted-foreground">{entry.findingsSummary}</p>
              <div className="flex gap-1 flex-wrap">
                {entry.notificationsSent.map((n, i) => (
                  <Badge key={i} variant={n.success ? "secondary" : "destructive"}>
                    {n.channel}: {n.success ? "sent" : "failed"}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
