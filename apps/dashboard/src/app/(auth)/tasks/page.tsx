"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useTasks, useReviewTask } from "@/hooks/use-marketplace";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskReviewDialog } from "@/components/tasks/task-review-dialog";
import { cn } from "@/lib/utils";
import type { MarketplaceTask } from "@/lib/api-client";

export default function TasksPage() {
  const { status } = useSession();
  const { data, isLoading } = useTasks();
  const reviewMutation = useReviewTask();
  const { toast } = useToast();

  const [tab, setTab] = useState<"review" | "all">("review");
  const [dialog, setDialog] = useState<{
    open: boolean;
    action: "approved" | "rejected";
    task: MarketplaceTask;
  } | null>(null);

  if (status === "unauthenticated") redirect("/login");

  const tasks = data ?? [];
  const reviewable = tasks.filter((t) => t.status === "awaiting_review" && t.output);
  const displayed = tab === "review" ? reviewable : tasks;

  const handleReview = async (result: "approved" | "rejected", reviewResult?: string) => {
    if (!dialog) return;
    try {
      await reviewMutation.mutateAsync({
        taskId: dialog.task.id,
        result,
        reviewResult,
      });
      toast({
        title: result === "approved" ? "Approved" : "Rejected",
        description:
          result === "approved"
            ? "Trust score updated. Agent earns more autonomy."
            : "Trust score updated. Agent requires more oversight.",
      });
      setDialog(null);
    } catch (err) {
      toast({
        title: "Review failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Tasks</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Review agent outputs. Your decisions shape their trust scores.
        </p>
      </section>

      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-border/60">
        {(
          [
            {
              key: "review" as const,
              label: `Review${reviewable.length > 0 ? ` · ${reviewable.length}` : ""}`,
            },
            { key: "all" as const, label: "All tasks" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast",
              tab === t.key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Task list */}
      {status === "loading" || isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[15px] text-foreground font-medium">
            {tab === "review" ? "Nothing to review." : "No tasks yet."}
          </p>
          <p className="text-[14px] text-muted-foreground mt-1.5">
            {tab === "review"
              ? "Agent outputs will appear here when they need your approval."
              : "Deploy an agent from the marketplace to start assigning tasks."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayed.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onApprove={(t) => setDialog({ open: true, action: "approved", task: t })}
              onReject={(t) => setDialog({ open: true, action: "rejected", task: t })}
            />
          ))}
        </div>
      )}

      {/* Review dialog */}
      {dialog && (
        <TaskReviewDialog
          open={dialog.open}
          onClose={() => setDialog(null)}
          action={dialog.action}
          taskCategory={dialog.task.category}
          isLoading={reviewMutation.isPending}
          onConfirm={(reviewResult) => handleReview(dialog.action, reviewResult)}
        />
      )}
    </div>
  );
}
