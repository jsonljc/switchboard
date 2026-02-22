import { z } from "zod";
import {
  PolicySchema,
  IdentitySpecSchema,
  RoleOverlaySchema,
} from "@switchboard/schemas";

// ── Actions ──────────────────────────────────────────────────────────

export const ProposeBodySchema = z.object({
  actionType: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  principalId: z.string().min(1),
  organizationId: z.string().optional(),
  cartridgeId: z.string().optional(),
  entityRefs: z
    .array(z.object({ inputRef: z.string(), entityType: z.string() }))
    .optional(),
  message: z.string().optional(),
});

export const BatchProposeBodySchema = z.object({
  proposals: z.array(
    z.object({
      actionType: z.string().min(1),
      parameters: z.record(z.string(), z.unknown()),
    }),
  ).min(1),
  principalId: z.string().min(1),
  organizationId: z.string().optional(),
  cartridgeId: z.string().optional(),
});

// ── Approvals ────────────────────────────────────────────────────────

export const ApprovalRespondBodySchema = z.object({
  action: z.enum(["approve", "reject", "patch"]),
  respondedBy: z.string().min(1),
  patchValue: z.record(z.string(), z.unknown()).optional(),
  bindingHash: z.string().optional(),
});

// ── Simulate ─────────────────────────────────────────────────────────

export const SimulateBodySchema = z.object({
  actionType: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  principalId: z.string().min(1),
  cartridgeId: z.string().optional(),
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
