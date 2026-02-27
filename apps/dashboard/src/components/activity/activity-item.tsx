"use client";

import { CheckCircle2, XCircle, Clock, Info, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import { translateEvent, getEventIcon } from "./event-translator";

const iconMap = {
  success: CheckCircle2,
  denied: XCircle,
  pending: Clock,
  info: Info,
  warning: AlertTriangle,
};

const iconColorMap = {
  success: "text-green-500",
  denied: "text-destructive",
  pending: "text-yellow-500",
  info: "text-blue-500",
  warning: "text-orange-500",
};

interface ActivityItemProps {
  entry: {
    id: string;
    eventType: string;
    timestamp: string;
    entityType: string;
    entityId: string;
    riskCategory: string;
    summary: string;
    snapshot: Record<string, unknown>;
  };
  onClick?: () => void;
}

export function ActivityItem({ entry, onClick }: ActivityItemProps) {
  const iconType = getEventIcon(entry.eventType);
  const Icon = iconMap[iconType];
  const iconColor = iconColorMap[iconType];
  const translated = translateEvent(entry);

  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 w-full text-left p-3 rounded-lg hover:bg-muted/50 transition-colors min-h-[44px]"
    >
      <div className={`mt-0.5 ${iconColor}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{translated}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(entry.timestamp)}
          </span>
          {entry.riskCategory !== "none" && entry.riskCategory !== "low" && (
            <Badge
              variant={entry.riskCategory === "critical" || entry.riskCategory === "high" ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {entry.riskCategory}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
