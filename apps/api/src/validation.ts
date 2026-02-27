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
  entityRefs: z
    .array(z.object({ inputRef: z.string(), entityType: z.string() }))
    .optional(),
  message: z.string().max(5000).optional(),
});

export const BatchProposeBodySchema = z.object({
  proposals: z.array(
    z.object({
      actionType: z.string().min(1).max(500),
      parameters: boundedParameters,
    }),
  ).min(1).max(50),
  principalId: z.string().min(1).max(500),
  organizationId: z.string().max(500).optional(),
  cartridgeId: z.string().max(500).optional(),
});

// ── Execute (unified runtime endpoint) ────────────────────────────────

export const ExecuteBodySchema = z.object({
  actorId: z.string().min(1).max(500),
  organizationId: z.string().max(500).optional().nullable(),
  action: ExecuteActionSchema,
  entityRefs: z
    .array(z.object({ inputRef: z.string(), entityType: z.string() }))
    .optional(),
  message: z.string().max(5000).optional(),
  traceId: z.string().max(500).optional(),
});

// ── Approvals ────────────────────────────────────────────────────────

export const ApprovalRespondBodySchema = z.object({
  action: z.enum(["approve", "reject", "patch"]),
  respondedBy: z.string().min(1).max(500),
  patchValue: z
    .record(z.string().max(200), z.unknown())
    .refine((obj) => JSON.stringify(obj).length <= 100_000, {
      message: "patchValue must be ≤ 100 KB when serialized",
    })
    .optional(),
  bindingHash: z.string().max(500).optional(),
});

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
