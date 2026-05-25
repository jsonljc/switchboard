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
  "action.partially_approved",
  "action.rejected",
  "action.patched",
  "action.queued",
  "action.executing",
  "action.snapshot",
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
  "entity.linked",
  "entity.unlinked",
  "entity.resolved",
  "event.published",
  "event.reaction.triggered",
  "event.reaction.created",
  "agent.activated",
  "agent.emergency-halted",
  "agent.resumed",
  "work_trace.persisted",
  "work_trace.updated",
  "work_trace.integrity_override",
  "infrastructure.job.retry_exhausted",
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
  /** Optional correlation id (e.g. from request); not part of chain hash. */
  traceId: z.string().nullable().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ─── Activity Browse Projection ───────────────────────────────────────────────

/**
 * Domain curation: events that map to operator-visible actions and
 * control-plane changes. Used by /activity Operational chip and any
 * future "operator-relevant" filter on event streams.
 *
 * Pinned by `operational-allowlist.test.ts`. Edits to this list are
 * contracts; the test forces the change through review.
 */
export const OPERATIONAL_AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "action.approved",
  "action.partially_approved",
  "action.rejected",
  "action.executed",
  "action.failed",
  "action.denied",
  "action.expired",
  "action.cancelled",
  "action.undo_requested",
  "action.undo_executed",
  "action.approval_expired",
  "agent.activated",
  "agent.emergency-halted",
  "agent.resumed",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "connection.established",
  "connection.revoked",
  "connection.degraded",
  "competence.promoted",
  "competence.demoted",
  "identity.created",
  "identity.updated",
  "overlay.activated",
  "overlay.deactivated",
  "work_trace.integrity_override",
  "infrastructure.job.retry_exhausted",
] as const;

/**
 * One row in the /activity Mercury list.
 *
 * Hard invariant: never carries `snapshot` values, never carries
 * `evidencePointers[].storageRef` content. Allowlisted snapshot key names
 * appear in `snapshotKeys`; everything else is rolled into `redactedKeyCount`.
 */
export const AuditEntryBrowseRowSchema = z.object({
  // Identity
  id: z.string(),
  eventType: AuditEventTypeSchema,
  timestamp: z.string(), // ISO8601, frontend resolves tz

  // Actor
  actorType: ActorTypeSchema,
  actorId: z.string(),

  // Entity
  entityType: z.string(),
  entityId: z.string(),

  // Classification
  riskCategory: RiskCategorySchema,
  visibilityLevel: VisibilityLevelSchema, // always 'public' or 'org' (server-filtered)

  // Content
  summary: z.string(), // freeform; server-trusted; rendered as text

  // Snapshot (redacted)
  snapshotKeys: z.array(z.string()), // allowlist intersection only
  redactedKeyCount: z.number().int().nonnegative(),

  // Evidence (full hash + display prefix; storageRef NEVER included)
  evidencePointers: z.array(
    z.object({
      type: z.enum(["inline", "pointer"]),
      hash: z.string(), // full hash (integrity anchor, not sensitive)
      hashPrefix: z.string(), // first 16 chars, for display (server-computed for cache stability)
    }),
  ),

  // Hash chain (full values, displayed truncated in the drawer with [copy full])
  entryHash: z.string(),
  previousEntryHash: z.string().nullable(),

  // References
  envelopeId: z.string().nullable(),
  traceId: z.string().nullable(),
});
export type AuditEntryBrowseRow = z.infer<typeof AuditEntryBrowseRowSchema>;

export const AuditEntriesListQuerySchema = z.object({
  // `operational` and `all` are user-controllable; `custom` is computed by the
  // backend when narrowing URL params are present (clients should not set it).
  scope: z.enum(["operational", "all"]).default("operational"),
  cursor: z.string().optional(), // base64url of {timestamp, id}; malformed → 400
  limit: z.coerce.number().int().min(1).max(100).default(50), // URL param arrives as string

  // URL-param escape hatches (no chrome). Presence of any of these
  // promotes the effective scope to `custom` in the response.
  eventType: AuditEventTypeSchema.optional(),
  actorType: ActorTypeSchema.optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
});
export type AuditEntriesListQuery = z.infer<typeof AuditEntriesListQuerySchema>;

export const AuditEntriesListResponseSchema = z.object({
  rows: z.array(AuditEntryBrowseRowSchema),
  nextCursor: z.string().nullable(),
  scope: z.enum(["operational", "all", "custom"]), // includes `custom` (server-derived)
  appliedFilters: z.object({
    eventType: AuditEventTypeSchema.nullable(),
    actorType: ActorTypeSchema.nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    after: z.string().nullable(),
    before: z.string().nullable(),
  }),
});
export type AuditEntriesListResponse = z.infer<typeof AuditEntriesListResponseSchema>;
