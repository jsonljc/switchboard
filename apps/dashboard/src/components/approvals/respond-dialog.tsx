"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RespondDialogProps {
  open: boolean;
  onClose: () => void;
  action: "approve" | "reject";
  approval: {
    id: string;
    summary: string;
    bindingHash: string;
    riskCategory: string;
  };
  onConfirm: () => void;
  isLoading?: boolean;
}

export function RespondDialog({
  open,
  onClose,
  action,
  approval,
  onConfirm,
  isLoading,
}: RespondDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {action === "approve" ? "Confirm Approval" : "Confirm Rejection"}
          </DialogTitle>
          <DialogDescription>
            {action === "approve"
              ? "Are you sure you want to approve this action?"
              : "Are you sure you want to reject this action?"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          <p className="text-sm font-medium">{approval.summary}</p>
          <div className="flex items-center gap-2">
            <Badge variant={approval.riskCategory === "high" || approval.riskCategory === "critical" ? "destructive" : "secondary"}>
              {approval.riskCategory} risk
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded break-all">
            Binding hash: {approval.bindingHash}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant={action === "approve" ? "default" : "destructive"}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : action === "approve" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
