"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Trash2, Play } from "lucide-react";
import type { ScheduledReportEntry } from "@/lib/api-client";

interface ReportCardProps {
  report: ScheduledReportEntry;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
}

export function ReportCard({ report, onToggle, onDelete, onRunNow }: ReportCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{report.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              checked={report.enabled}
              onCheckedChange={(checked) => onToggle(report.id, checked)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onRunNow(report.id)}
              title="Run now"
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(report.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{report.reportType}</Badge>
            <span className="font-mono text-sm text-muted-foreground">{report.cronExpression}</span>
            <span className="text-xs text-muted-foreground">({report.timezone})</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {report.platform && <Badge variant="outline">{report.platform}</Badge>}
            {report.deliveryChannels.map((ch) => (
              <Badge key={ch} variant="secondary">{ch}</Badge>
            ))}
          </div>

          <div className="text-xs text-muted-foreground space-y-0.5">
            {report.lastRunAt && (
              <p>Last run: {new Date(report.lastRunAt).toLocaleString()}</p>
            )}
            {report.nextRunAt && (
              <p>Next run: {new Date(report.nextRunAt).toLocaleString()}</p>
            )}
            {!report.enabled && (
              <Badge variant="secondary">Disabled</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
