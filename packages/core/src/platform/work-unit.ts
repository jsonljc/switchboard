import { createId } from "@paralleldrive/cuid2";
import type { ExecutionModeName, Actor, Trigger, Priority } from "./types.js";

export interface SubmitWorkRequest {
  organizationId: string;
  actor: Actor;
  intent: string;
  parameters: Record<string, unknown>;
  suggestedMode?: ExecutionModeName;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  trigger: Trigger;
  priority?: Priority;
}

export interface WorkUnit {
  id: string;
  requestedAt: string;
  organizationId: string;
  actor: Actor;
  intent: string;
  parameters: Record<string, unknown>;
  suggestedMode?: ExecutionModeName;
  resolvedMode: ExecutionModeName;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId: string;
  trigger: Trigger;
  priority: Priority;
}

export function normalizeWorkUnit(
  request: SubmitWorkRequest,
  resolvedMode: ExecutionModeName,
): WorkUnit {
  return {
    id: createId(),
    requestedAt: new Date().toISOString(),
    organizationId: request.organizationId,
    actor: request.actor,
    intent: request.intent,
    parameters: request.parameters,
    suggestedMode: request.suggestedMode,
    resolvedMode,
    idempotencyKey: request.idempotencyKey,
    parentWorkUnitId: request.parentWorkUnitId,
    traceId: request.traceId ?? createId(),
    trigger: request.trigger,
    priority: request.priority ?? "normal",
  };
}
