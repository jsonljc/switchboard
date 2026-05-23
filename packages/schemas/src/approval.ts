import { z } from "zod";
import { ApprovalRequestSchema } from "./chat.js";

/**
 * Date fields here use `z.date()`, not `z.coerce.date()`. This is the
 * in-process runtime/domain shape — every caller hands a real `Date`
 * object. Coercion would silently accept ISO strings and blur the
 * runtime-vs-wire seam called out in the PR-2 plan's Schema boundary
 * rule (Route Governance Contract v1 §8.1). The
 * `rejects ISO-string dates` test in `__tests__/approval.test.ts`
 * locks the no-coercion contract.
 */

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "patched",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const QuorumEntrySchema = z.object({
  approverId: z.string(),
  hash: z.string(),
  approvedAt: z.date(),
});
export type QuorumEntry = z.infer<typeof QuorumEntrySchema>;

export const QuorumStateSchema = z.object({
  required: z.number().int().min(1),
  approvalHashes: z.array(QuorumEntrySchema),
});
export type QuorumState = z.infer<typeof QuorumStateSchema>;

/**
 * Canonical persistable shape of an approval's lifecycle state. Hoisted from
 * `packages/core/src/approval/state-machine.ts` per Route Governance Contract
 * v1 §8.1 (cross-app types live in `@switchboard/schemas`). Core's
 * `ApprovalState` is now `z.infer<typeof ApprovalStateSchema>`.
 */
export const ApprovalStateSchema = z.object({
  status: ApprovalStatusSchema,
  respondedBy: z.string().nullable(),
  respondedAt: z.date().nullable(),
  patchValue: z.record(z.string(), z.unknown()).nullable(),
  expiresAt: z.date(),
  version: z.number().int().min(1),
  quorum: QuorumStateSchema.nullable(),
});
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

/**
 * The persistable record shape for an approval — the pair of (request, state)
 * plus the envelope it belongs to. Replaces the 3+ local declarations of
 * `interface ApprovalRecord` that previously lived in `apps/api`,
 * `packages/core`, and `packages/db`. Route Governance Contract v1 §8.1.
 */
export const ApprovalRecordSchema = z.object({
  request: ApprovalRequestSchema,
  state: ApprovalStateSchema,
  envelopeId: z.string(),
  organizationId: z.string().nullable(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
