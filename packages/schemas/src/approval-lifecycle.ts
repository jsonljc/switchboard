import { z } from "zod";

export const ApprovalLifecycleStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "recovery_required",
]);
export type ApprovalLifecycleStatus = z.infer<typeof ApprovalLifecycleStatusSchema>;

export const ApprovalLifecycleSchema = z.object({
  id: z.string(),
  actionEnvelopeId: z.string(),
  organizationId: z.string().nullable(),
  status: ApprovalLifecycleStatusSchema,
  currentRevisionId: z.string().nullable(),
  currentExecutableWorkUnitId: z.string().nullable(),
  expiresAt: z.coerce.date(),
  pausedSessionId: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ApprovalLifecycle = z.infer<typeof ApprovalLifecycleSchema>;

export const ApprovalRevisionSchema = z.object({
  id: z.string(),
  lifecycleId: z.string(),
  revisionNumber: z.number().int().min(1),
  parametersSnapshot: z.record(z.unknown()),
  approvalScopeSnapshot: z.record(z.unknown()),
  bindingHash: z.string(),
  rationale: z.string().nullable(),
  supersedesRevisionId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
});
export type ApprovalRevision = z.infer<typeof ApprovalRevisionSchema>;

export const ExecutableWorkUnitSchema = z.object({
  id: z.string(),
  lifecycleId: z.string(),
  approvalRevisionId: z.string(),
  actionEnvelopeId: z.string(),
  frozenPayload: z.record(z.unknown()),
  frozenBinding: z.record(z.unknown()),
  frozenExecutionPolicy: z.record(z.unknown()),
  executableUntil: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type ExecutableWorkUnit = z.infer<typeof ExecutableWorkUnitSchema>;

export const DispatchRecordStateSchema = z.enum([
  "dispatching",
  "succeeded",
  "failed",
  "terminal_failed",
]);
export type DispatchRecordState = z.infer<typeof DispatchRecordStateSchema>;

export const DispatchRecordSchema = z.object({
  id: z.string(),
  executableWorkUnitId: z.string(),
  attemptNumber: z.number().int().min(1),
  idempotencyKey: z.string(),
  state: DispatchRecordStateSchema,
  dispatchedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  outcome: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().nullable(),
});
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>;

export const LifecycleCommandSchema = z.enum([
  "create_gated_lifecycle",
  "create_revision",
  "approve_revision",
  "reject_revision",
  "create_revision_and_approve",
  "expire_lifecycle",
  "dispatch_executable_work_unit",
  "record_dispatch_outcome",
]);
export type LifecycleCommand = z.infer<typeof LifecycleCommandSchema>;
