"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface FailedMessage {
  id: string;
  channel: string;
  stage: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  status: string;
  createdAt: string;
}

export function DlqViewer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["dlq", "messages"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/dlq?status=pending&limit=20");
      if (!res.ok) throw new Error("Failed to fetch DLQ");
      return res.json() as Promise<{ messages: FailedMessage[] }>;
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/dlq/${id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Retry failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dlq"] });
      toast({ title: "Retry queued" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/dlq/${id}/resolve`, { method: "POST" });
      if (!res.ok) throw new Error("Resolve failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dlq"] });
      toast({ title: "Message resolved" });
    },
  });

  if (isLoading) return <p className="text-[13px] text-muted-foreground">Loading...</p>;

  const messages = data?.messages ?? [];

  return (
    <div className="space-y-2">
      {messages.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No failed messages.</p>
      ) : (
        messages.map((msg) => (
          <div key={msg.id} className="px-3 py-2 rounded-lg border border-border text-[13px]">
            <div className="flex justify-between mb-1">
              <span className="font-medium text-foreground">{msg.stage}</span>
              <span className="text-muted-foreground text-[11px]">
                {msg.retryCount}/{msg.maxRetries} retries
              </span>
            </div>
            <p className="text-destructive text-[12px] mb-2">{msg.errorMessage}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => retryMutation.mutate(msg.id)}
                disabled={retryMutation.isPending}
              >
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => resolveMutation.mutate(msg.id)}
                disabled={resolveMutation.isPending}
              >
                Resolve
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
