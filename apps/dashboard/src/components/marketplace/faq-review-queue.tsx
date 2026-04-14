"use client";

import { Check, X, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDraftFAQs, useApproveFAQ, useRejectFAQ } from "@/hooks/use-marketplace";

interface FAQReviewQueueProps {
  deploymentId: string;
}

function formatTimeLeft(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
  return `${hours}h left`;
}

export function FAQReviewQueue({ deploymentId }: FAQReviewQueueProps) {
  const { data: drafts, isLoading } = useDraftFAQs(deploymentId);
  const approveMutation = useApproveFAQ(deploymentId);
  const rejectMutation = useRejectFAQ(deploymentId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileQuestion className="h-4 w-4" />
            FAQ Drafts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!drafts || drafts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileQuestion className="h-4 w-4" />
          FAQ Drafts
          <Badge variant="secondary">{drafts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm">{draft.content}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {formatTimeLeft(draft.draftExpiresAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => approveMutation.mutate(draft.id)}
                disabled={approveMutation.isPending}
              >
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => rejectMutation.mutate(draft.id)}
                disabled={rejectMutation.isPending}
              >
                <X className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
