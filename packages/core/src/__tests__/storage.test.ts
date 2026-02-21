import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryEnvelopeStore,
  InMemoryPolicyStore,
  InMemoryIdentityStore,
  InMemoryApprovalStore,
  InMemoryCartridgeRegistry,
  createInMemoryStorage,
} from "../storage/index.js";
import type {
  ActionEnvelope,
  Policy,
  IdentitySpec,
  RoleOverlay,
} from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { Cartridge } from "@switchboard/cartridge-sdk";

function makeEnvelope(overrides?: Partial<ActionEnvelope>): ActionEnvelope {
  const now = new Date();
  return {
    id: overrides?.id ?? `env_test_${Date.now()}`,
    version: 1,
    incomingMessage: null,
    conversationId: null,
    proposals: [],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: "proposed",
    createdAt: now,
    updatedAt: now,
    parentEnvelopeId: null,
    ...overrides,
  };
}

function makePolicy(overrides?: Partial<Policy>): Policy {
  const now = new Date();
  return {
    id: overrides?.id ?? `policy_test_${Date.now()}`,
    name: "Test Policy",
    description: "A test policy",
    organizationId: null,
    cartridgeId: null,
    priority: 10,
    active: true,
    rule: { conditions: [{ field: "actionType", operator: "eq", value: "test" }] },
    effect: "allow",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeIdentitySpec(overrides?: Partial<IdentitySpec>): IdentitySpec {
  const now = new Date();
  return {
    id: overrides?.id ?? `spec_test_${Date.now()}`,
    principalId: "user_1",
    organizationId: null,
    name: "Test User",
    description: "Test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("InMemoryEnvelopeStore", () => {
  let store: InMemoryEnvelopeStore;

  beforeEach(() => {
    store = new InMemoryEnvelopeStore();
  });

  it("should save and retrieve by id", async () => {
    const envelope = makeEnvelope({ id: "env_1" });
    await store.save(envelope);
    const retrieved = await store.getById("env_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("env_1");
  });

  it("should return null for non-existent id", async () => {
    const result = await store.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("should update an envelope", async () => {
    const envelope = makeEnvelope({ id: "env_2", status: "proposed" });
    await store.save(envelope);
    await store.update("env_2", { status: "approved" });
    const retrieved = await store.getById("env_2");
    expect(retrieved?.status).toBe("approved");
  });

  it("should throw when updating non-existent envelope", async () => {
    await expect(
      store.update("nonexistent", { status: "approved" }),
    ).rejects.toThrow("Envelope not found");
  });

  it("should list with status filter", async () => {
    await store.save(makeEnvelope({ id: "env_a", status: "proposed" }));
    await store.save(makeEnvelope({ id: "env_b", status: "approved" }));
    await store.save(makeEnvelope({ id: "env_c", status: "proposed" }));

    const proposed = await store.list({ status: "proposed" });
    expect(proposed).toHaveLength(2);

    const approved = await store.list({ status: "approved" });
    expect(approved).toHaveLength(1);
  });

  it("should list with limit", async () => {
    await store.save(makeEnvelope({ id: "env_x" }));
    await store.save(makeEnvelope({ id: "env_y" }));
    await store.save(makeEnvelope({ id: "env_z" }));

    const limited = await store.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe("InMemoryPolicyStore", () => {
  let store: InMemoryPolicyStore;

  beforeEach(() => {
    store = new InMemoryPolicyStore();
  });

  it("should save and retrieve by id", async () => {
    const policy = makePolicy({ id: "pol_1" });
    await store.save(policy);
    const retrieved = await store.getById("pol_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe("Test Policy");
  });

  it("should update a policy", async () => {
    const policy = makePolicy({ id: "pol_2" });
    await store.save(policy);
    await store.update("pol_2", { name: "Updated Policy" });
    const retrieved = await store.getById("pol_2");
    expect(retrieved?.name).toBe("Updated Policy");
  });

  it("should delete a policy", async () => {
    const policy = makePolicy({ id: "pol_3" });
    await store.save(policy);
    const deleted = await store.delete("pol_3");
    expect(deleted).toBe(true);
    const retrieved = await store.getById("pol_3");
    expect(retrieved).toBeNull();
  });

  it("should return false when deleting non-existent policy", async () => {
    const deleted = await store.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("should list active policies sorted by priority", async () => {
    await store.save(makePolicy({ id: "p1", priority: 20, active: true }));
    await store.save(makePolicy({ id: "p2", priority: 5, active: true }));
    await store.save(makePolicy({ id: "p3", priority: 10, active: false }));

    const active = await store.listActive();
    expect(active).toHaveLength(2);
    expect(active[0]?.id).toBe("p2");
    expect(active[1]?.id).toBe("p1");
  });

  it("should filter by cartridgeId", async () => {
    await store.save(makePolicy({ id: "p_a", cartridgeId: "ads-spend", active: true }));
    await store.save(makePolicy({ id: "p_b", cartridgeId: "other", active: true }));
    await store.save(makePolicy({ id: "p_c", cartridgeId: null, active: true }));

    const filtered = await store.listActive({ cartridgeId: "ads-spend" });
    // Should include p_a (matches cartridge) and p_c (null = global)
    expect(filtered).toHaveLength(2);
    const ids = filtered.map((p) => p.id);
    expect(ids).toContain("p_a");
    expect(ids).toContain("p_c");
  });
});

describe("InMemoryIdentityStore", () => {
  let store: InMemoryIdentityStore;

  beforeEach(() => {
    store = new InMemoryIdentityStore();
  });

  it("should save and retrieve spec by id", async () => {
    const spec = makeIdentitySpec({ id: "spec_1" });
    await store.saveSpec(spec);
    const retrieved = await store.getSpecById("spec_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe("Test User");
  });

  it("should retrieve spec by principalId", async () => {
    const spec = makeIdentitySpec({ id: "spec_2", principalId: "user_42" });
    await store.saveSpec(spec);
    const retrieved = await store.getSpecByPrincipalId("user_42");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("spec_2");
  });

  it("should return null for unknown principalId", async () => {
    const result = await store.getSpecByPrincipalId("unknown");
    expect(result).toBeNull();
  });

  it("should save and list overlays", async () => {
    const overlay: RoleOverlay = {
      id: "overlay_1",
      identitySpecId: "spec_1",
      name: "Test Overlay",
      description: "",
      mode: "restrict",
      priority: 1,
      active: true,
      conditions: {},
      overrides: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.saveOverlay(overlay);
    const overlays = await store.listOverlaysBySpecId("spec_1");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.name).toBe("Test Overlay");
  });

  it("should update existing overlay", async () => {
    const overlay: RoleOverlay = {
      id: "overlay_2",
      identitySpecId: "spec_1",
      name: "Original",
      description: "",
      mode: "restrict",
      priority: 1,
      active: true,
      conditions: {},
      overrides: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.saveOverlay(overlay);
    await store.saveOverlay({ ...overlay, name: "Updated" });
    const overlays = await store.listOverlaysBySpecId("spec_1");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.name).toBe("Updated");
  });
});

describe("InMemoryApprovalStore", () => {
  let store: InMemoryApprovalStore;

  const makeApproval = (id: string, status: ApprovalState["status"] = "pending") => ({
    request: {
      id,
      actionId: "action_1",
      envelopeId: "env_1",
      conversationId: null,
      summary: "Test action",
      riskCategory: "medium",
      bindingHash: "abc123",
      evidenceBundle: {
        decisionTrace: {},
        contextSnapshot: {},
        identitySnapshot: {},
      },
      suggestedButtons: [],
      approvers: [],
      fallbackApprover: null,
      status: status as "pending" | "approved" | "rejected" | "expired" | "patched",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(Date.now() + 3600000),
      expiredBehavior: "deny" as const,
      createdAt: new Date(),
    },
    state: {
      status,
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(Date.now() + 3600000),
    } as ApprovalState,
    envelopeId: "env_1",
  });

  beforeEach(() => {
    store = new InMemoryApprovalStore();
  });

  it("should save and retrieve by id", async () => {
    const approval = makeApproval("appr_1");
    await store.save(approval);
    const retrieved = await store.getById("appr_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.request.id).toBe("appr_1");
  });

  it("should return null for non-existent approval", async () => {
    const result = await store.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("should update state", async () => {
    await store.save(makeApproval("appr_2"));
    const newState: ApprovalState = {
      status: "approved",
      respondedBy: "admin",
      respondedAt: new Date(),
      patchValue: null,
      expiresAt: new Date(Date.now() + 3600000),
    };
    await store.updateState("appr_2", newState);
    const retrieved = await store.getById("appr_2");
    expect(retrieved?.state.status).toBe("approved");
    expect(retrieved?.state.respondedBy).toBe("admin");
  });

  it("should list pending approvals", async () => {
    await store.save(makeApproval("appr_a", "pending"));
    await store.save(makeApproval("appr_b", "approved"));
    await store.save(makeApproval("appr_c", "pending"));

    const pending = await store.listPending();
    expect(pending).toHaveLength(2);
  });
});

describe("InMemoryCartridgeRegistry", () => {
  let registry: InMemoryCartridgeRegistry;

  beforeEach(() => {
    registry = new InMemoryCartridgeRegistry();
  });

  it("should register and get a cartridge", () => {
    const mockCartridge = { manifest: { id: "test" } } as unknown as Cartridge;
    registry.register("test", mockCartridge);
    const retrieved = registry.get("test");
    expect(retrieved).toBe(mockCartridge);
  });

  it("should return null for unknown cartridge", () => {
    const result = registry.get("unknown");
    expect(result).toBeNull();
  });

  it("should list registered cartridge ids", () => {
    const c1 = { manifest: { id: "a" } } as unknown as Cartridge;
    const c2 = { manifest: { id: "b" } } as unknown as Cartridge;
    registry.register("a", c1);
    registry.register("b", c2);
    const ids = registry.list();
    expect(ids).toEqual(["a", "b"]);
  });
});

describe("createInMemoryStorage", () => {
  it("should create a StorageContext with all stores", () => {
    const storage = createInMemoryStorage();
    expect(storage.envelopes).toBeDefined();
    expect(storage.policies).toBeDefined();
    expect(storage.identity).toBeDefined();
    expect(storage.approvals).toBeDefined();
    expect(storage.cartridges).toBeDefined();
  });
});
