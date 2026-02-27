"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { RespondDialog } from "@/components/approvals/respond-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApprovals } from "@/hooks/use-approvals";
import { useAudit } from "@/hooks/use-audit";
import { ActivityItem } from "@/components/activity/activity-item";
import { queryKeys } from "@/lib/query-keys";

export default function ApprovalsPage() {
  const { data: session, status } = useSession();
  const { data: approvalsData, isLoading } = useApprovals();
  const { data: historyData } = useAudit({ eventType: "action.approved", limit: 20 });
  const queryClient = useQueryClient();

  const [dialog, setDialog] = useState<{
    open: boolean;
    action: "approve" | "reject";
    approval: { id: string; summary: string; bindingHash: string; riskCategory: string };
  } | null>(null);

  const respondMutation = useMutation({
    mutationFn: async ({ approvalId, action, bindingHash }: { approvalId: string; action: string; bindingHash: string }) => {
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action,
          respondedBy: (session as any)?.principalId ?? "dashboard-user",
          bindingHash,
        }),
      });
      if (!res.ok) throw new Error("Failed to respond");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
      setDialog(null);
    },
  });

  if (status === "unauthenticated") redirect("/login");

  const handleApprove = (id: string, bindingHash: string) => {
    const approval = approvalsData?.approvals.find((a) => a.id === id);
    if (approval) {
      setDialog({
        open: true,
        action: "approve",
        approval: { id, summary: approval.summary, bindingHash, riskCategory: approval.riskCategory },
      });
    }
  };

  const handleReject = (id: string) => {
    const approval = approvalsData?.approvals.find((a) => a.id === id);
    if (approval) {
      setDialog({
        open: true,
        action: "reject",
        approval: { id, summary: approval.summary, bindingHash: approval.bindingHash, riskCategory: approval.riskCategory },
      });
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Approvals</h1>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({approvalsData?.approvals.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3 mt-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))
          ) : approvalsData?.approvals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No pending approvals</p>
            </div>
          ) : (
            approvalsData?.approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="space-y-1">
            {historyData?.entries.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
            {historyData?.entries.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No approval history</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {dialog && (
        <RespondDialog
          open={dialog.open}
          onClose={() => setDialog(null)}
          action={dialog.action}
          approval={dialog.approval}
          isLoading={respondMutation.isPending}
          onConfirm={() =>
            respondMutation.mutate({
              approvalId: dialog.approval.id,
              action: dialog.action,
              bindingHash: dialog.approval.bindingHash,
            })
          }
        />
      )}
    </div>
  );
}
