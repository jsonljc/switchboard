// ---------------------------------------------------------------------------
// Channel approval respond flow, outcome-returning
// ---------------------------------------------------------------------------
//
// The single auth-bearing respond flow for channel surfaces: approval lookup,
// org check, state pre-check, timing-safe hash check, binding + role identity
// derivation, unified-engine call, error mapping. Two consumers, one
// implementation:
//   - the gateway's in-process mode (handle-approval-response.ts),
//   - the API internal bridge route (apps/api routes/internal-chat-approvals).
// The flow ends in respondToApproval or respondToParkedLifecycle; there is no
// parallel approve path.
//
// Outcomes are wire-safe (spec 2026-06-05-chat-approval-bridge-design.md
// section 3): reply rendering stays in the gateway.

import { timingSafeEqual } from "node:crypto";
import type { ExecuteResult, Principal } from "@switchboard/schemas";
import type { ApprovalStore, IdentityStore } from "../storage/interfaces.js";
import type { OperatorChannelBindingStore } from "./operator-channel-binding-store.js";
import type { RespondToApprovalDeps } from "../approval/respond-to-approval.js";
import { respondToApproval } from "../approval/respond-to-approval.js";
import {
  respondToParkedLifecycle,
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "../approval/respond-to-parked-lifecycle.js";
import { DispatchAdmissionError } from "../approval/dispatch-admission.js";
import { StaleVersionError } from "../approval/state-machine.js";

/** Everything the chat process attests about a respond tap. respondedBy is
 * deliberately NOT representable: identity is derived from the binding. */
export interface ChannelApprovalRespondRequest {
  approvalId: string;
  action: "approve" | "reject";
  bindingHash: string;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
}

export type ChannelApprovalRefusalCode =
  | "not_found"
  | "stale"
  | "not_authorized"
  | "lookup_error"
  | "already_responded"
  | "conflict"
  | "expired"
  | "self_approval"
  | "admission_failed"
  | "execution_error";

export type ChannelApprovalRespondOutcome =
  | {
      kind: "responded";
      action: "approve" | "reject";
      /** executionResult.success; null = quorum still open (and reject). */
      executionSuccess: boolean | null;
    }
  | { kind: "refused"; code: ChannelApprovalRefusalCode };

/** Cross-process seam: prod = HTTP to the API internal route; tests = inject. */
export interface ApprovalRespondTransport {
  respond(request: ChannelApprovalRespondRequest): Promise<ChannelApprovalRespondOutcome>;
}

/**
 * Authority stack: nullable so the unconfigured gateway keeps today's exact
 * fail-closed semantics (pre-checks still run; authorization always refuses).
 * "Configured" means all three of bindingStore/identityStore/respondDeps.
 */
export interface ChannelApprovalRespondDeps {
  approvalStore: ApprovalStore;
  bindingStore: OperatorChannelBindingStore | null;
  identityStore: IdentityStore | null;
  respondDeps: RespondToApprovalDeps | null;
}

/**
 * Roles that authorize a Principal to respond to approvals from a bound
 * channel. We deliberately exclude `emergency_responder` here: emergency
 * overrides exist for incident response on the API/dashboard surface and do
 * not belong on a chat surface, where the caller can't see the broader system
 * state required to use that role responsibly. The chat surface is stricter
 * than the API route because the caller's authority is asserted via a binding
 * lookup, not auth.
 */
export const APPROVER_ROLES = ["approver", "operator", "admin"] as const;

function principalHasApproverRole(principal: Principal): boolean {
  return principal.roles.some((r) => (APPROVER_ROLES as readonly string[]).includes(r));
}

function timingSafeMatch(stored: string | undefined | null, supplied: string): boolean {
  if (typeof stored !== "string" || stored.length === 0) return false;
  if (stored.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(supplied, "utf8"));
}

interface ConfiguredAuthority {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
}

function configuredAuthority(deps: ChannelApprovalRespondDeps): ConfiguredAuthority | null {
  if (!deps.bindingStore || !deps.identityStore || !deps.respondDeps) return null;
  return {
    bindingStore: deps.bindingStore,
    identityStore: deps.identityStore,
    respondDeps: deps.respondDeps,
  };
}

/**
 * Channel-possession alone is NOT authority: require an active
 * OperatorChannelBinding to a Principal carrying an approver role. Runs at
 * respond time, never cached from button issuance, so a revocation or role
 * downgrade takes effect on the very next tap. Returns null (caller refuses
 * not_authorized) when unwired or unauthorized.
 */
async function deriveOperatorPrincipal(
  authority: ConfiguredAuthority | null,
  request: ChannelApprovalRespondRequest,
): Promise<string | null> {
  if (!authority) return null;
  const binding = await authority.bindingStore.findActiveBinding({
    organizationId: request.organizationId,
    channel: request.channel,
    channelIdentifier: request.channelIdentifier,
  });
  if (!binding) return null;
  const principal = await authority.identityStore.getPrincipal(binding.principalId);
  if (!principal || !principalHasApproverRole(principal)) return null;
  return binding.principalId;
}

/** The gateway's replyForError, recast to wire-safe codes (spec table 3.3). */
export function refusalCodeForError(err: unknown): ChannelApprovalRefusalCode {
  if (err instanceof StaleVersionError) return "conflict";
  if (err instanceof ParkedLifecycleNotFoundError) return "not_found";
  if (err instanceof ParkedLifecycleAlreadyRespondedError) return "already_responded";
  if (err instanceof ParkedLifecycleExpiredError) return "expired";
  if (err instanceof DispatchAdmissionError) return "admission_failed";
  if (err instanceof Error && /lifecycle status is "/.test(err.message)) {
    // Race: another responder mutated state between our pre-check and the
    // lifecycle call ("Cannot approve: lifecycle status is ...").
    return "conflict";
  }
  if (err instanceof Error && /stale binding/i.test(err.message)) return "stale";
  if (err instanceof Error && /self-approval/i.test(err.message)) return "self_approval";
  return "execution_error";
}

function respondedOutcome(
  action: "approve" | "reject",
  executionResult: ExecuteResult | null,
): ChannelApprovalRespondOutcome {
  return {
    kind: "responded",
    action,
    executionSuccess: executionResult === null ? null : executionResult.success,
  };
}

function refused(code: ChannelApprovalRefusalCode): ChannelApprovalRespondOutcome {
  return { kind: "refused", code };
}

export async function respondToChannelApproval(
  deps: ChannelApprovalRespondDeps,
  request: ChannelApprovalRespondRequest,
): Promise<ChannelApprovalRespondOutcome> {
  let approval: Awaited<ReturnType<ApprovalStore["getById"]>>;
  try {
    approval = await deps.approvalStore.getById(request.approvalId);
  } catch {
    return refused("lookup_error");
  }

  if (!approval) {
    // Lifecycle fallback (mirrors the #877 route fallback): parked WorkUnits
    // and post-restart in-memory rows have no ApprovalRequest row; the id on
    // the button may be a lifecycle id. Approve on recovery_required IS retry.
    return respondViaLifecycleFallback(deps, request);
  }

  if (approval.organizationId !== request.organizationId) return refused("not_found");

  // Pre-check approval state. Once an approval has been responded to or
  // expired, retrying here is futile and confusing; the operator needs a
  // distinct already-handled outcome (vs. a downstream failure).
  if (approval.state.status !== "pending") return refused("already_responded");

  if (!timingSafeMatch(approval.request.bindingHash, request.bindingHash)) {
    return refused("stale");
  }

  // Hash matches, but channel-possession alone is NOT authority.
  const authority = configuredAuthority(deps);
  const principalId = await deriveOperatorPrincipal(authority, request);
  if (!principalId || !authority) return refused("not_authorized");

  try {
    const result = await respondToApproval(
      authority.respondDeps,
      {
        approvalId: request.approvalId,
        action: request.action,
        respondedBy: principalId,
        bindingHash: request.bindingHash,
      },
      approval,
    );
    return respondedOutcome(request.action, result.executionResult);
  } catch (err) {
    return refused(refusalCodeForError(err));
  }
}

/**
 * Lifecycle fallback leg: the approval row is missing but the id may be an
 * ApprovalLifecycle id (parked WorkUnits; future lifecycle-native chat
 * notifications; in-memory rows lost to a restart in dev). Same authority
 * model as the legacy leg: org check, hash pre-check against the CURRENT
 * revision (approve only), binding + role auth, then the lifecycle-native
 * respond (whose approve-on-recovery_required IS the retry leg).
 */
async function respondViaLifecycleFallback(
  deps: ChannelApprovalRespondDeps,
  request: ChannelApprovalRespondRequest,
): Promise<ChannelApprovalRespondOutcome> {
  const authority = configuredAuthority(deps);
  const lifecycleService = authority?.respondDeps.lifecycleService ?? null;
  const workTraceStore = authority?.respondDeps.workTraceStore ?? null;
  if (!authority || !lifecycleService || !workTraceStore) return refused("not_found");

  let lifecycle;
  try {
    lifecycle = await lifecycleService.getLifecycleById(request.approvalId);
  } catch {
    return refused("lookup_error");
  }
  if (!lifecycle || lifecycle.organizationId !== request.organizationId) {
    return refused("not_found");
  }

  // Approve commits to the CURRENT revision; refuse a button whose hash no
  // longer matches it (e.g. after a patch) before any mutation. Reject
  // deliberately skips this pre-check: the parked contract (and the API
  // route) accept a reject without a binding hash; authority comes from the
  // binding + role, not from hash possession. Reject is terminal-safe (it
  // executes nothing), so this mirrors the shipped surface contract.
  if (request.action === "approve") {
    let revision;
    try {
      revision = await lifecycleService.getCurrentRevision(lifecycle.id);
    } catch {
      return refused("lookup_error");
    }
    if (!timingSafeMatch(revision?.bindingHash, request.bindingHash)) {
      return refused("stale");
    }
  }

  const principalId = await deriveOperatorPrincipal(authority, request);
  if (!principalId) return refused("not_authorized");

  try {
    const result = await respondToParkedLifecycle(
      {
        lifecycleService,
        workTraceStore,
        platformLifecycle: authority.respondDeps.platformLifecycle,
        auditLedger: authority.respondDeps.auditLedger,
        logger: authority.respondDeps.logger,
        selfApprovalAllowed: authority.respondDeps.selfApprovalAllowed,
      },
      {
        lifecycleId: lifecycle.id,
        action: request.action,
        respondedBy: principalId,
        bindingHash: request.bindingHash,
      },
    );
    return respondedOutcome(request.action, result.executionResult);
  } catch (err) {
    return refused(refusalCodeForError(err));
  }
}
