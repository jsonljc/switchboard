"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCountdown, formatRelativeTime } from "@/lib/utils";
import { Clock, AlertTriangle } from "lucide-react";

interface ApprovalCardProps {
  approval: {
    id: string;
    summary: string;
    riskCategory: string;
    expiresAt: string;
    bindingHash: string;
    createdAt: string;
  };
  onApprove: (id: string, bindingHash: string) => void;
  onReject: (id: string) => void;
}

const riskBadgeVariant = (risk: string) => {
  if (risk === "critical" || risk === "high") return "destructive" as const;
  if (risk === "medium") return "secondary" as const;
  return "outline" as const;
};

export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const countdown = formatCountdown(approval.expiresAt);
  const isExpired = countdown === "expired";

  return (
    <Card className={isExpired ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{approval.summary}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={riskBadgeVariant(approval.riskCategory)}>
                {approval.riskCategory} risk
              </Badge>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{countdown}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(approval.createdAt)}
              </span>
            </div>
          </div>
        </div>
        {!isExpired && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={() => onApprove(approval.id, approval.bindingHash)}
              className="flex-1 min-h-[44px]"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(approval.id)}
              className="flex-1 min-h-[44px]"
            >
              Reject
            </Button>
          </div>
        )}
        {isExpired && (
          <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span>This approval has expired</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
