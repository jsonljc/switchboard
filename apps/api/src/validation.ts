import { z } from "zod";
import {
  PolicySchema,
  IdentitySpecSchema,
  RoleOverlaySchema,
  ExecuteActionSchema,
} from "@switchboard/schemas";

// ── Shared size guards ──────────────────────────────────────────────

const boundedParameters = z
  .record(z.string().max(200), z.unknown())
  .refine((obj) => JSON.stringify(obj).length <= 100_000, {
    message: "parameters must be ≤ 100 KB when serialized",
  });

// ── Actions ──────────────────────────────────────────────────────────

export const ProposeBodySchema = z.object({
  actionType: z.string().min(1).max(500),
  parameters: boundedParameters,
  principalId: z.string().min(1).max(500),
  organizationId: z.string().max(500).optional(),
  cartridgeId: z.string().max(500).optional(),
  entityRefs: z.array(z.object({ inputRef: z.string(), entityType: z.string() })).optional(),
  message: z.string().max(5000).optional(),
});

export const BatchProposeBodySchema = z.object({
  proposals: z
    .array(
      z.object({
        actionType: z.string().min(1).max(500),
        parameters: boundedParameters,
      }),
    )
    .min(1)
    .max(50),
  principalId: z.string().min(1).max(500),
  organizationId: z.string().max(500).optional(),
  cartridgeId: z.string().max(500).optional(),
  batchCorrelationId: z.string().max(500).optional(),
});

// ── Execute (unified runtime endpoint) ────────────────────────────────

export const ExecuteBodySchema = z.object({
  actorId: z.string().min(1).max(500),
  organizationId: z.string().max(500).optional().nullable(),
  action: ExecuteActionSchema,
  entityRefs: z.array(z.object({ inputRef: z.string(), entityType: z.string() })).optional(),
  message: z.string().max(5000).optional(),
  traceId: z.string().max(500).optional(),
});

// ── Approvals ────────────────────────────────────────────────────────

export const ApprovalRespondBodySchema = z.object({
  action: z.enum(["approve", "reject", "patch"]),
  /**
   * Optional since the lifecycle-native leg: the route derives the responder
   * from the authenticated principal. When both are present they must match
   * (403 otherwise). Body fallback is honored only when auth is disabled
   * (dev/test).
   */
  respondedBy: z.string().min(1).max(500).optional(),
  /** Optional operator note recorded in the audit ledger snapshot. */
  note: z.string().max(2000).optional(),
  patchValue: z
    .record(z.string().max(200), z.unknown())
    .refine((obj) => JSON.stringify(obj).length <= 100_000, {
      message: "patchValue must be ≤ 100 KB when serialized",
    })
    .optional(),
  bindingHash: z.string().max(500).optional(),
});

/**
 * Internal chat-approval bridge respond body (bridge spec section 3.1).
 * .strict() is load-bearing: identity fields (respondedBy and friends) must be
 * unrepresentable on this wire; the binding lookup is the only authority.
 */
export const InternalChatApprovalRespondBodySchema = z
  .object({
    approvalId: z.string().min(1).max(500),
    action: z.enum(["approve", "reject"]),
    bindingHash: z.string().min(1).max(500),
    channel: z.string().min(1).max(100),
    channelIdentifier: z.string().min(1).max(500),
    organizationId: z.string().min(1).max(500),
  })
  .strict();

// ── Simulate ─────────────────────────────────────────────────────────

export const SimulateBodySchema = z.object({
  actionType: z.string().min(1).max(500),
  parameters: boundedParameters,
  principalId: z.string().min(1).max(500),
  cartridgeId: z.string().max(500).optional(),
});

// ── Policies ─────────────────────────────────────────────────────────

export const CreatePolicyBodySchema = PolicySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdatePolicyBodySchema = PolicySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

// ── Identity Specs ───────────────────────────────────────────────────

export const CreateIdentitySpecBodySchema = IdentitySpecSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateIdentitySpecBodySchema = IdentitySpecSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

// ── Role Overlays ────────────────────────────────────────────────────

export const CreateRoleOverlayBodySchema = RoleOverlaySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateRoleOverlayBodySchema = RoleOverlaySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

// ── Interpreter Config (FIX-11) ──────────────────────────────────────

export const InterpreterConfigSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  model: z.string().max(200).optional(),
  provider: z.string().max(200).optional(),
});

export const RoutingConfigSchema = z.object({
  organizationId: z.string().min(1).max(500),
  preferredInterpreter: z.string().min(1).max(200),
  fallbackChain: z.array(z.string().max(200)).max(20).optional(),
});

// ── Connections ──────────────────────────────────────────────────────

export const CreateConnectionBodySchema = z.object({
  serviceId: z.string().min(1).max(200),
  serviceName: z.string().min(1).max(200),
  authType: z.string().min(1).max(100),
  credentials: z
    .record(z.string().max(200), z.unknown())
    .refine((obj) => JSON.stringify(obj).length <= 50_000, {
      message: "credentials must be ≤ 50 KB when serialized",
    }),
  scopes: z.array(z.string().max(200)).max(50).optional(),
});

export const UpdateConnectionBodySchema = z.object({
  serviceName: z.string().min(1).max(200).optional(),
  authType: z.string().min(1).max(100).optional(),
  credentials: z
    .record(z.string().max(200), z.unknown())
    .refine((obj) => JSON.stringify(obj).length <= 50_000, {
      message: "credentials must be ≤ 50 KB when serialized",
    })
    .optional(),
  scopes: z.array(z.string().max(200)).max(50).optional(),
});

// Setter for the Facebook Page id stored in a meta-ads connection's credentials.
// Meta ad `page_id` requires the numeric Page ID (a vanity username will not work);
// the 5–32 digit bound rejects trivial typos. Format is a sanity check — the
// human-gated publish step is the ultimate validator.
export const SetMetaPageIdBodySchema = z.object({
  pageId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/, "Facebook Page id must be the numeric Page ID (digits only)."),
});

// ── Governance ──────────────────────────────────────────────────────

export const SetGovernanceProfileBodySchema = z.object({
  profile: z.enum(["observe", "guarded", "strict", "locked"]),
});

export const EmergencyHaltBodySchema = z.object({
  organizationId: z.string().min(1).max(500).optional(),
  reason: z.string().max(2000).optional(),
});

export const ResumeBodySchema = z.object({
  organizationId: z.string().min(1).max(500).optional(),
});

// ── Internal chat-to-API ingress (F-15) ──────────────────────────────
// The chat service forwards the canonical submit request it built (it resolved
// organizationId server-side from the channel token). The enums mirror ActorType /
// Trigger / SurfaceName in packages/core/src/platform/ so the chat path
// (type:"user", trigger:"chat") and CTWA path (type:"system", trigger:"internal")
// both validate and reach submit with faithful types.
export const InternalIngressSubmitBodySchema = z.object({
  organizationId: z.string().min(1).max(200),
  actor: z.object({
    id: z.string().min(1).max(200),
    type: z.enum(["user", "agent", "system", "service"]),
  }),
  intent: z.string().min(1).max(200),
  parameters: boundedParameters.optional(),
  trigger: z.enum(["chat", "api", "schedule", "internal"]).optional(),
  surface: z
    .object({
      surface: z.enum(["api", "mcp", "chat", "dashboard"]),
      sessionId: z.string().max(500).optional(),
      requestId: z.string().max(500).optional(),
      correlationId: z.string().max(500).optional(),
    })
    .optional(),
  targetHint: z
    .object({
      skillSlug: z.string().max(200).optional(),
      deploymentId: z.string().max(200).optional(),
      channel: z.string().max(50).optional(),
      token: z.string().max(500).optional(),
    })
    .optional(),
  traceId: z.string().max(200).optional(),
  idempotencyKey: z.string().max(500).optional(),
  contactId: z.string().max(200).optional(),
  conversationThreadId: z.string().max(200).optional(),
  // Lineage: the CTWA producer threads parentWorkUnitId (ctwa-ingress-request.ts); forward
  // it so a chained submit's parent link survives the hop. `priority`/`suggestedMode` are
  // intentionally omitted (no producer sets them over this hop) and would be stripped.
  parentWorkUnitId: z.string().max(200).optional(),
});
