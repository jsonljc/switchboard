"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { AlertRule } from "@/lib/api-client";

interface AlertRuleCardProps {
  rule: AlertRule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}

const operatorLabels: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
  pctChange_gt: "|%| >",
  pctChange_lt: "|%| <",
};

export function AlertRuleCard({ rule, onToggle, onDelete, onSelect }: AlertRuleCardProps) {
  const isSnoozed = rule.snoozedUntil && new Date(rule.snoozedUntil) > new Date();

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onSelect(rule.id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{rule.name}</CardTitle>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={rule.enabled}
              onCheckedChange={(checked) => onToggle(rule.id, checked)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(rule.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{rule.metricPath}</span>{" "}
            {operatorLabels[rule.operator] ?? rule.operator}{" "}
            <span className="font-semibold">{rule.threshold}</span>
          </p>

          <div className="flex flex-wrap gap-1">
            {rule.platform && (
              <Badge variant="outline">{rule.platform}</Badge>
            )}
            <Badge variant="secondary">
              cooldown: {rule.cooldownMinutes}m
            </Badge>
            {rule.notifyChannels.map((ch) => (
              <Badge key={ch} variant="outline">{ch}</Badge>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {rule.lastTriggeredAt && (
              <span>Last triggered: {new Date(rule.lastTriggeredAt).toLocaleString()}</span>
            )}
            {isSnoozed && (
              <Badge variant="secondary">Snoozed</Badge>
            )}
            {!rule.enabled && (
              <Badge variant="secondary">Disabled</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
