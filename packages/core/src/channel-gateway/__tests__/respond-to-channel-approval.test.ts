import { describe, it, expect, vi } from "vitest";
import {
  respondToChannelApproval,
  refusalCodeForError,
  type ChannelApprovalRespondDeps,
  type ChannelApprovalRespondRequest,
} from "../respond-to-channel-approval.js";
import { StaleVersionError } from "../../approval/state-machine.js";
import {
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
  ParkedLifecycleNotAuthorizedError,
} from "../../approval/respond-to-parked-lifecycle.js";
import { DispatchAdmissionError } from "../../approval/dispatch-admission.js";
import {
  PAYLOAD,
  REJECT_PAYLOAD,
  BASE_ARGS,
  makeApproval,
  makeStore,
  makeBindingStore,
  makeIdentityStore,
  makePrincipal,
  makeRespondDeps,
  makeLifecycleWorld,
} from "./approval-response-fixtures.js";

function makeRequest(
  overrides: Partial<ChannelApprovalRespondRequest> = {},
): ChannelApprovalRespondRequest {
  return {
    approvalId: PAYLOAD.approvalId,
    action: PAYLOAD.action,
    bindingHash: PAYLOAD.bindingHash,
    organizationId: BASE_ARGS.organizationId,
    channel: BASE_ARGS.channel,
    channelIdentifier: BASE_ARGS.channelIdentifier,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ChannelApprovalRespondDeps> = {}): ChannelApprovalRespondDeps {
  return {
    approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval())),
    bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
    identityStore: makeIdentityStore(makePrincipal(["operator"])),
    respondDeps: makeRespondDeps() as never,
    ...overrides,
  };
}

describe("respondToChannelApproval: legacy-row leg refusals", () => {
  it("returns lookup_error when getById throws", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockRejectedValue(new Error("db down"))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "lookup_error",
    });
  });

  it("returns not_found on org mismatch (no existence leak)", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(
        vi.fn().mockResolvedValue(makeApproval({ organizationId: "org-other" })),
      ),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_found",
    });
  });

  it("returns not_found when stored organizationId is null", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval({ organizationId: null }))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_found",
    });
  });

  it("returns already_responded when state is not pending", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval({ status: "approved" }))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "already_responded",
    });
  });

  it("returns stale on binding hash mismatch (timing-safe compare)", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(
        vi.fn().mockResolvedValue(makeApproval({ bindingHash: "different" })),
      ),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "stale",
    });
  });

  it("returns stale when stored hash is empty (defensive)", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval({ bindingHash: "" }))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "stale",
    });
  });

  it("returns not_authorized when the authority stack is unwired (fail closed)", async () => {
    const deps = makeDeps({ bindingStore: null, identityStore: null, respondDeps: null });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("returns not_authorized when no active binding exists", async () => {
    const deps = makeDeps({ bindingStore: makeBindingStore(null) });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("returns not_authorized when the principal lacks an approver role", async () => {
    const deps = makeDeps({ identityStore: makeIdentityStore(makePrincipal(["requester"])) });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("returns not_authorized when the principal record is missing", async () => {
    const deps = makeDeps({ identityStore: makeIdentityStore(null) });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("queries the binding with the attested identity triple", async () => {
    const bindingStore = makeBindingStore({ principalId: "principal-1" } as never);
    const deps = makeDeps({ bindingStore });
    await respondToChannelApproval(deps, makeRequest());
    expect(bindingStore.findActiveBinding).toHaveBeenCalledWith({
      organizationId: BASE_ARGS.organizationId,
      channel: BASE_ARGS.channel,
      channelIdentifier: BASE_ARGS.channelIdentifier,
    });
  });
});

describe("respondToChannelApproval: legacy-row leg responds", () => {
  it("approve drives the engine with the binding principal and returns executionSuccess true", async () => {
    const respondDeps = makeRespondDeps();
    const deps = makeDeps({ respondDeps: respondDeps as never });
    const outcome = await respondToChannelApproval(deps, makeRequest());
    expect(outcome).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    expect(respondDeps.platformLifecycle.respondToApproval).toHaveBeenCalledWith(
      expect.objectContaining({ respondedBy: "principal-1", action: "approve" }),
    );
  });

  it("reject responds with executionSuccess null", async () => {
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi.fn().mockResolvedValue({
      envelope: { id: "env_1" },
      approvalState: { status: "rejected" },
      executionResult: null,
    });
    const deps = makeDeps({ respondDeps: respondDeps as never });
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ action: REJECT_PAYLOAD.action }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "reject", executionSuccess: null });
  });

  it("maps a thrown engine error through refusalCodeForError", async () => {
    const deps = makeDeps({ respondDeps: makeRespondDeps({ throwInRespond: true }) as never });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "execution_error",
    });
  });
});

describe("respondToChannelApproval: lifecycle fallback leg", () => {
  it("returns not_found when no approval row and no lifecycle stack", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(null)),
      respondDeps: null,
      bindingStore: null,
      identityStore: null,
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_found",
    });
  });

  it("approves a parked lifecycle through the real service and dispatch spy", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
  });

  it("fallback org mismatch returns not_found", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id, organizationId: "org-other" }),
    );
    expect(outcome).toEqual({ kind: "refused", code: "not_found" });
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("fallback approve refuses a hash that does not match the current revision", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id, bindingHash: "wrong-hash" }),
    );
    expect(outcome).toEqual({ kind: "refused", code: "stale" });
  });

  it("fallback reject skips the hash pre-check and responds (parked-leg contract)", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id, action: "reject", bindingHash: "wrong-hash" }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "reject", executionSuccess: null });
  });

  it("double respond returns already_responded with exactly one dispatch", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const req = makeRequest({ approvalId: w.lifecycle.id });
    expect(await respondToChannelApproval(deps, req)).toEqual({
      kind: "responded",
      action: "approve",
      executionSuccess: true,
    });
    expect(await respondToChannelApproval(deps, req)).toEqual({
      kind: "refused",
      code: "already_responded",
    });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
  });
});

describe("refusalCodeForError", () => {
  it.each<[unknown, string]>([
    [new StaleVersionError("appr_1", 1, 2), "conflict"],
    [new ParkedLifecycleNotFoundError("lc-1"), "not_found"],
    [new ParkedLifecycleAlreadyRespondedError("lc-1", "approved"), "already_responded"],
    [new ParkedLifecycleExpiredError("lc-1"), "expired"],
    [new DispatchAdmissionError("EXPIRED_WORK_UNIT", "expired work unit"), "admission_failed"],
    [new Error('Cannot approve: lifecycle status is "approved"'), "conflict"],
    [new Error("stale binding hash"), "stale"],
    [new Error("Self-approval is not permitted"), "self_approval"],
    [new ParkedLifecycleNotAuthorizedError("lc-1", "intruder"), "not_authorized"],
    [new Error("anything else"), "execution_error"],
    ["not-an-error", "execution_error"],
  ])("maps %s to %s", (err, code) => {
    expect(refusalCodeForError(err)).toBe(code);
  });
});

describe("respondToChannelApproval: A16 designated-approver membership (fallback leg)", () => {
  it("refuses not_authorized when the bound approver is not in the revision's approvers list", async () => {
    // The bound principal ("principal-1") carries an approver role, so the surface
    // role floor passes, but it is NOT a designated approver for this action. The
    // shared core membership spine (respondToParkedLifecycle) must refuse, surfacing
    // as not_authorized via refusalCodeForError.
    const w = await makeLifecycleWorld({ noApprovalRow: true, approvers: ["someone-else"] });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id }),
    );
    expect(outcome).toEqual({ kind: "refused", code: "not_authorized" });
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("approves when the bound approver IS a designated approver", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true, approvers: ["principal-1"] });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
  });
});
