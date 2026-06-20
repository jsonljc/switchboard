"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useResolveDisqualification } from "@/hooks/use-resolve-disqualification";
import type { PendingDisqualification } from "@/hooks/use-pending-disqualifications";

interface DisqualificationRowProps {
  item: PendingDisqualification;
}

export function DisqualificationRow({ item }: DisqualificationRowProps) {
  const { toast } = useToast();

  const confirmMutation = useResolveDisqualification("confirm");
  const dismissMutation = useResolveDisqualification("dismiss");

  const isPending = confirmMutation.isPending || dismissMutation.isPending;

  const candidate = item.evidence?.candidates?.[0];
  const candidateLabel = item.evidence?.candidateType ?? candidate?.type ?? "—";
  const evidenceText = item.evidence?.evidenceQuote ?? candidate?.evidence ?? "—";

  async function handleAction(mutation: ReturnType<typeof useResolveDisqualification>) {
    try {
      await mutation.mutateAsync({ threadId: item.conversationThreadId });
    } catch (err: unknown) {
      const typed = err as { status?: number; reason?: string; message?: string } | null;
      if (typed?.status === 409) {
        toast({
          title: "Already resolved",
          description: "This thread has already been processed.",
        });
      } else {
        toast({
          title: "Action failed",
          description: typed?.message ?? "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    }
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-4 text-[13px] text-foreground font-mono">
        {item.conversationThreadId.slice(0, 8)}…
      </td>
      <td className="py-3 pr-4 text-[13px] text-muted-foreground">{item.contactId}</td>
      <td className="py-3 pr-4 text-[13px] text-muted-foreground">{item.currentState}</td>
      <td className="py-3 pr-4 text-[13px] text-muted-foreground">{candidateLabel}</td>
      <td className="py-3 pr-4 text-[13px] text-muted-foreground max-w-[280px] truncate">
        {evidenceText}
      </td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="action"
            disabled={isPending}
            onClick={() => handleAction(confirmMutation)}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => handleAction(dismissMutation)}
          >
            Dismiss
          </Button>
        </div>
      </td>
    </tr>
  );
}
