"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSetMetaPageId } from "@/hooks/use-connections";
import { useToast } from "@/components/ui/use-toast";

const PAGE_ID_RE = /^\d{5,32}$/;

export function SetMetaPageIdDialog({
  connectionId,
  onClose,
}: {
  connectionId: string | null;
  onClose: () => void;
}) {
  const [pageId, setPageId] = useState("");
  const { toast } = useToast();
  const setMetaPageId = useSetMetaPageId();

  const trimmed = pageId.trim();
  const isValid = PAGE_ID_RE.test(trimmed);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionId || !isValid) return;
    setMetaPageId.mutate(
      { id: connectionId, pageId: trimmed },
      {
        onSuccess: () => {
          toast({
            title: "Facebook Page saved",
            description: "Mira can now stage paused ads for this connection.",
          });
          setPageId("");
          onClose();
        },
        onError: (err: unknown) => {
          toast({
            variant: "destructive",
            title: "Could not save Page id",
            description: err instanceof Error ? err.message : "Please try again.",
          });
        },
      },
    );
  };

  return (
    <Dialog open={!!connectionId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Facebook Page</DialogTitle>
          <DialogDescription>
            Store the numeric Facebook Page ID this connection&apos;s ads run from.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meta-page-id">Facebook Page ID</Label>
            <Input
              id="meta-page-id"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="123456789012345"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              The numeric Page ID (digits only) of the Facebook Page your ads run from. Find it in
              Meta Business Suite under your Page&apos;s settings. Required before Mira can stage
              paused ads.
            </p>
            {pageId.length > 0 && !isValid && (
              <p className="text-xs text-destructive">Enter the numeric Page ID (digits only).</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || setMetaPageId.isPending}>
              {setMetaPageId.isPending ? "Saving..." : "Save Page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
