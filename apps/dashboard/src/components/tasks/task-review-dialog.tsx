"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface TaskReviewDialogProps {
  open: boolean;
  onClose: () => void;
  action: "approved" | "rejected";
  taskCategory: string;
  isLoading: boolean;
  onConfirm: (reviewResult?: string) => void;
}

export function TaskReviewDialog({
  open,
  onClose,
  action,
  taskCategory,
  isLoading,
  onConfirm,
}: TaskReviewDialogProps) {
  const [feedback, setFeedback] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "approved" ? "Approve" : "Reject"} this output?</DialogTitle>
          <DialogDescription>
            {action === "approved"
              ? `This will improve the agent's trust score for "${taskCategory}" tasks.`
              : `This will lower the agent's trust score for "${taskCategory}" tasks.`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Label htmlFor="feedback" className="text-[13px]">
            Feedback (optional)
          </Label>
          <Textarea
            id="feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={
              action === "approved" ? "What was good about this output?" : "What needs to improve?"
            }
            className="mt-1.5"
            rows={2}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant={action === "approved" ? "default" : "destructive"}
            onClick={() => {
              onConfirm(feedback || undefined);
              setFeedback("");
            }}
            disabled={isLoading}
          >
            {isLoading ? "Submitting..." : action === "approved" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
