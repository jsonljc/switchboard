import type { OwnerTask, TaskStatus } from "@switchboard/schemas";

export interface CreateOwnerTaskInput {
  organizationId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  type: "fallback_handoff" | "approval_required" | "manual_action" | "review_needed";
  title: string;
  description: string;
  suggestedAction?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  triggerReason: string;
  sourceAgent?: string | null;
  fallbackReason?: "not_configured" | "paused" | "errored" | null;
  dueAt?: Date | null;
}

export interface OwnerTaskStore {
  create(input: CreateOwnerTaskInput): Promise<OwnerTask>;
  findPending(orgId: string): Promise<OwnerTask[]>;
  updateStatus(
    orgId: string,
    id: string,
    status: TaskStatus,
    completedAt?: Date,
  ): Promise<OwnerTask>;
  autoComplete(orgId: string, opportunityId: string, reason: string): Promise<number>;
}
