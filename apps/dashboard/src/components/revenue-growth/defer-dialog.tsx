"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface DeferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

export function DeferDialog({ open, onOpenChange, onConfirm }: DeferDialogProps) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Defer Intervention</DialogTitle>
          <DialogDescription>
            Provide a reason for deferring this intervention. It will be revisited in the next
            diagnostic cycle.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you deferring this?"
          className="w-full min-h-[80px] rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="text-[13px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm(reason || "No reason provided");
              setReason("");
            }}
            className="text-[13px] font-medium text-foreground bg-muted hover:bg-muted/80 px-4 py-1.5 rounded-lg transition-colors"
          >
            Confirm Defer
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
