import { z } from "zod";
import { RiskCategorySchema } from "./risk.js";

export const VisibilityLevelSchema = z.enum(["public", "org", "admin", "system"]);
export type VisibilityLevel = z.infer<typeof VisibilityLevelSchema>;

export const ActorTypeSchema = z.enum(["user", "agent", "service_account", "system"]);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const EvidencePointerSchema = z.object({
  type: z.enum(["inline", "pointer"]),
  hash: z.string(),
  storageRef: z.string().nullable(),
});
export type EvidencePointer = z.infer<typeof EvidencePointerSchema>;

export const AuditEventTypeSchema = z.enum([
  "action.proposed",
  "action.resolved",
  "action.enriched",
  "action.evaluated",
  "action.approved",
  "action.rejected",
  "action.patched",
  "action.queued",
  "action.executing",
  "action.executed",
  "action.failed",
  "action.denied",
  "action.expired",
  "action.cancelled",
  "action.undo_requested",
  "action.undo_executed",
  "action.approval_expired",
  "identity.created",
  "identity.updated",
  "overlay.activated",
  "overlay.deactivated",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "connection.established",
  "connection.revoked",
  "connection.degraded",
  "competence.promoted",
  "competence.demoted",
  "competence.updated",
  "delegation.chain_resolved",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  eventType: AuditEventTypeSchema,
  timestamp: z.coerce.date(),

  // Actor
  actorType: ActorTypeSchema,
  actorId: z.string(),

  // Entity
  entityType: z.string(),
  entityId: z.string(),

  // Classification
  riskCategory: RiskCategorySchema,
  visibilityLevel: VisibilityLevelSchema,

  // Content
  summary: z.string(),
  snapshot: z.record(z.string(), z.unknown()),

  // Evidence
  evidencePointers: z.array(EvidencePointerSchema),

  // Redaction
  redactionApplied: z.boolean(),
  redactedFields: z.array(z.string()),

  // Hash chain
  chainHashVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  entryHash: z.string(),
  previousEntryHash: z.string().nullable(),

  // References
  envelopeId: z.string().nullable(),
  organizationId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
