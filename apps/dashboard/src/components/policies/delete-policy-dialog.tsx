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
import type { Policy } from "@switchboard/schemas";

interface DeletePolicyDialogProps {
  open: boolean;
  onClose: () => void;
  policy: Policy;
  onConfirm: () => void;
  isLoading?: boolean;
}

const effectBadgeVariant = (effect: string) => {
  switch (effect) {
    case "deny":
      return "destructive" as const;
    case "require_approval":
      return "secondary" as const;
    case "modify":
      return "outline" as const;
    default:
      return "default" as const;
  }
};

export function DeletePolicyDialog({
  open,
  onClose,
  policy,
  onConfirm,
  isLoading,
}: DeletePolicyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Policy</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this policy? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          <p className="text-sm font-medium">{policy.name}</p>
          <div className="flex items-center gap-2">
            <Badge variant={effectBadgeVariant(policy.effect)}>
              {policy.effect.replace("_", " ")}
            </Badge>
            <Badge variant="outline">priority {policy.priority}</Badge>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
