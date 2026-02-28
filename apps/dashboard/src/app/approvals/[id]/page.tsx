"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RespondDialog } from "@/components/approvals/respond-dialog";
import { queryKeys } from "@/lib/query-keys";
import { formatDate, formatCountdown } from "@/lib/utils";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface ApprovalDetailData {
  request: {
    id: string;
    summary: string;
    riskCategory: string;
    bindingHash: string;
    approvers: string[];
    createdAt: string;
  };
  state: {
    status: string;
    expiresAt: string;
    respondedBy?: string;
    respondedAt?: string;
  };
  envelopeId: string;
}

export default function ApprovalDetailPage() {
  const { data: session, status: authStatus } = useSession();
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.approvals.detail(id),
    queryFn: async (): Promise<ApprovalDetailData> => {
      const res = await fetch(`/api/dashboard/approvals?id=${id}`);
      if (!res.ok) throw new Error("Failed to fetch approval");
      return res.json();
    },
  });

  const [dialog, setDialog] = useState<{
    open: boolean;
    action: "approve" | "reject";
  } | null>(null);

  const respondMutation = useMutation({
    mutationFn: async ({ action, bindingHash }: { action: string; bindingHash: string }) => {
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: id,
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

  if (authStatus === "unauthenticated") redirect("/login");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Failed to load approval</span>
          </div>
          <p className="text-sm text-muted-foreground">{(error as Error)?.message}</p>
          <Link href="/approvals">
            <Button variant="outline" size="sm" className="mt-4">Back to Approvals</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { request, state } = data;
  const countdown = formatCountdown(state.expiresAt);
  const isExpired = countdown === "expired";
  const isPending = state.status === "pending";

  const riskBadgeVariant =
    request.riskCategory === "critical" || request.riskCategory === "high"
      ? ("destructive" as const)
      : request.riskCategory === "medium"
      ? ("secondary" as const)
      : ("outline" as const);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/approvals">
          <Button variant="ghost" size="icon" aria-label="Go back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Approval Detail</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{request.summary}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-sm text-muted-foreground">Status</span>
              <div className="mt-1">
                <Badge variant={isPending ? "secondary" : state.status === "approved" ? "default" : "destructive"}>
                  {state.status}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Risk Category</span>
              <div className="mt-1">
                <Badge variant={riskBadgeVariant}>{request.riskCategory} risk</Badge>
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Created</span>
              <p className="text-sm font-medium mt-1">{formatDate(request.createdAt)}</p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Expires</span>
              <p className="text-sm font-medium mt-1">{countdown}</p>
            </div>
            {state.respondedBy && (
              <div>
                <span className="text-sm text-muted-foreground">Responded By</span>
                <p className="text-sm font-medium mt-1 font-mono">{state.respondedBy}</p>
              </div>
            )}
            {state.respondedAt && (
              <div>
                <span className="text-sm text-muted-foreground">Responded At</span>
                <p className="text-sm font-medium mt-1">{formatDate(state.respondedAt)}</p>
              </div>
            )}
          </div>

          <div>
            <span className="text-sm text-muted-foreground">Binding Hash</span>
            <p className="text-xs font-mono bg-muted p-2 rounded mt-1 break-all">{request.bindingHash}</p>
          </div>

          {request.approvers.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Approvers</span>
              <div className="flex gap-1 mt-1 flex-wrap">
                {request.approvers.map((a) => (
                  <Badge key={a} variant="outline" className="font-mono text-xs">{a}</Badge>
                ))}
              </div>
            </div>
          )}

          {isPending && !isExpired && (
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 min-h-[44px]"
                onClick={() => setDialog({ open: true, action: "approve" })}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                className="flex-1 min-h-[44px]"
                onClick={() => setDialog({ open: true, action: "reject" })}
              >
                Reject
              </Button>
            </div>
          )}

          {isExpired && isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span>This approval has expired</span>
            </div>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <RespondDialog
          open={dialog.open}
          onClose={() => setDialog(null)}
          action={dialog.action}
          approval={{
            id: request.id,
            summary: request.summary,
            bindingHash: request.bindingHash,
            riskCategory: request.riskCategory,
          }}
          isLoading={respondMutation.isPending}
          onConfirm={() =>
            respondMutation.mutate({
              action: dialog.action,
              bindingHash: request.bindingHash,
            })
          }
        />
      )}
    </div>
  );
}
