"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { translateEvent, getEventIcon } from "./event-translator";
import { formatDate } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ActivityDetailProps {
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
}

export function ActivityDetail({ entry }: ActivityDetailProps) {
  const [showRaw, setShowRaw] = useState(false);
  const translated = translateEvent(entry);
  const iconType = getEventIcon(entry.eventType);

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle>{translated}</SheetTitle>
        <SheetDescription>{entry.eventType}</SheetDescription>
      </SheetHeader>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Timestamp</span>
          <span className="text-sm font-medium">{formatDate(entry.timestamp)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Risk Category</span>
          <Badge
            variant={
              entry.riskCategory === "critical" || entry.riskCategory === "high"
                ? "destructive"
                : entry.riskCategory === "medium"
                ? "secondary"
                : "outline"
            }
          >
            {entry.riskCategory}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Entity</span>
          <span className="text-sm font-medium font-mono">
            {entry.entityType}/{entry.entityId}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Status</span>
          <Badge variant={iconType === "success" ? "default" : iconType === "denied" ? "destructive" : "secondary"}>
            {iconType}
          </Badge>
        </div>
      </div>

      <Separator />

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Raw Event Data
        </Button>
        {showRaw && (
          <pre className="mt-2 p-3 bg-muted rounded-md text-xs overflow-auto max-h-64">
            {JSON.stringify(entry.snapshot, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
