import { randomUUID } from "node:crypto";
import type { ApprovalCheckpoint, PendingAction } from "@switchboard/schemas";
import type { ApprovalCheckpointStore } from "./store-interfaces.js";

export interface CreateCheckpointInput {
  workflowId: string;
  stepIndex: number;
  action: PendingAction;
  reason: string;
  ttlMs: number;
  modifiableFields?: string[];
  alternatives?: Array<{ label: string; parameters: Record<string, unknown> }>;
  notifyChannels?: Array<"telegram" | "whatsapp" | "dashboard">;
}

export function createApprovalCheckpoint(input: CreateCheckpointInput): ApprovalCheckpoint {
  const now = new Date();
  const options: Array<"approve" | "reject" | "modify"> = ["approve", "reject"];
  if (input.modifiableFields && input.modifiableFields.length > 0) {
    options.push("modify");
  }
  return {
    id: randomUUID(),
    workflowId: input.workflowId,
    stepIndex: input.stepIndex,
    actionId: input.action.id,
    reason: input.reason,
    options,
    modifiableFields: input.modifiableFields ?? [],
    alternatives: input.alternatives ?? [],
    notifyChannels: input.notifyChannels ?? ["dashboard"],
    status: "pending",
    resolution: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + input.ttlMs),
  };
}

export interface ResolveInput {
  decidedBy: string;
  action: "approve" | "reject" | "modify";
  selectedAlternative?: number;
  fieldEdits?: Record<string, unknown>;
}

export async function resolveCheckpoint(
  store: ApprovalCheckpointStore,
  checkpointId: string,
  input: ResolveInput,
): Promise<void> {
  const checkpoint = await store.getById(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint ${checkpointId} not found`);
  if (checkpoint.status !== "pending") {
    throw new Error(
      `Checkpoint ${checkpointId} is already resolved (status: ${checkpoint.status})`,
    );
  }
  const statusMap: Record<string, ApprovalCheckpoint["status"]> = {
    approve: "approved",
    reject: "rejected",
    modify: "modified",
  };
  await store.update(checkpointId, {
    status: statusMap[input.action],
    resolution: {
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
      selectedAlternative: input.selectedAlternative ?? null,
      fieldEdits: input.fieldEdits ?? null,
    },
  });
}

export function isCheckpointExpired(checkpoint: ApprovalCheckpoint, now?: Date): boolean {
  return (now ?? new Date()).getTime() >= checkpoint.expiresAt.getTime();
}
