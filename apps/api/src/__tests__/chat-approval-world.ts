// ── Shared chat-approval test world ──
//
// Helpers shared by chat-approval-loop.test.ts (in-process gateway proof,
// #891) and chat-approval-bridge-loop.test.ts (the bridged twin over the
// internal route + HTTP transport). Extracted so both suites drive the SAME
// world shape; lives outside the test files to keep each under the line
// gates (the approval-response-fixtures.ts pattern).

import { expect } from "vitest";
import type { OperatorChannelBindingStore, ReplySink } from "@switchboard/core";
import { executeWeeklyAudit } from "@switchboard/ad-optimizer";
import { ORG, buildCronDeps, step, type ParkedHandoff } from "./recommendation-handoff-harness.js";
import type { buildLifecycleWorld } from "./recommendation-handoff-lifecycle-world.js";

export const OPERATOR_PRINCIPAL = "principal-op-1";
export const CHANNEL = "whatsapp";
export const CHANNEL_IDENTIFIER = "+6591234567";

export async function parkViaCron(w: ReturnType<typeof buildLifecycleWorld>) {
  const parked: ParkedHandoff[] = [];
  await executeWeeklyAudit(
    step as Parameters<typeof executeWeeklyAudit>[0],
    buildCronDeps(w.harness.ingress, parked),
  );
  expect(parked).toHaveLength(1);
  const res = parked[0]!.res;
  if (!res.ok) throw new Error("submit failed");
  return {
    workUnitId: res.workUnit.id,
    lifecycleId: (res as unknown as { lifecycleId: string }).lifecycleId,
    bindingHash: (res as unknown as { bindingHash: string }).bindingHash,
  };
}

/** Seed the legacy ApprovalRequest row that coexists with the lifecycle row. */
export async function seedLegacyApprovalRow(
  w: ReturnType<typeof buildLifecycleWorld>,
  parked: { workUnitId: string; bindingHash: string },
): Promise<string> {
  const { createApprovalState } = await import("@switchboard/core");
  const approvalId = "appr_chat_1";
  const expiresAt = new Date(Date.now() + 3_600_000);
  const request = {
    id: approvalId,
    actionId: `prop_${parked.workUnitId}`,
    envelopeId: parked.workUnitId,
    conversationId: null,
    summary: "adoptimizer.recommendation.handoff (requested by system)",
    riskCategory: "medium",
    bindingHash: parked.bindingHash,
    evidenceBundle: { decisionTrace: null, contextSnapshot: {}, identitySnapshot: {} },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: [OPERATOR_PRINCIPAL],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    expiredBehavior: "deny",
    createdAt: new Date(),
    quorum: null,
  };
  await w.storage.approvals.save({
    request: request as never,
    state: createApprovalState(expiresAt, null),
    envelopeId: parked.workUnitId,
    organizationId: ORG,
  });
  return approvalId;
}

export function replyCapture(): { sink: ReplySink; replies: string[] } {
  const replies: string[] = [];
  return {
    sink: {
      send: async (text) => {
        replies.push(text);
      },
    },
    replies,
  };
}

/** Org-and-triple-exact binding fixture: the bridged world's authority row. */
export function bindingStoreFor(orgId: string, principalId: string): OperatorChannelBindingStore {
  return {
    findActiveBinding: async (q) =>
      q.organizationId === orgId &&
      q.channel === CHANNEL &&
      q.channelIdentifier === CHANNEL_IDENTIFIER
        ? ({ principalId } as never)
        : null,
  };
}

/** The bridge route derives the principal from app.storageContext.identity;
 * seed the operator there for bridged worlds. */
export async function seedOperatorPrincipal(
  w: ReturnType<typeof buildLifecycleWorld>,
): Promise<void> {
  await w.storage.identity.savePrincipal({
    id: OPERATOR_PRINCIPAL,
    type: "user",
    name: "Chat Operator",
    organizationId: ORG,
    roles: ["operator"],
  });
}
