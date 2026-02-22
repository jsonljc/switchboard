export type {
  EnvelopeStore,
  PolicyStore,
  IdentityStore,
  ApprovalStore,
  CartridgeRegistry,
  StorageContext,
} from "./interfaces.js";

export {
  InMemoryEnvelopeStore,
  InMemoryPolicyStore,
  InMemoryIdentityStore,
  InMemoryApprovalStore,
  InMemoryCartridgeRegistry,
} from "./in-memory.js";

import type { Policy } from "@switchboard/schemas";
import type { StorageContext } from "./interfaces.js";
import {
  InMemoryEnvelopeStore,
  InMemoryPolicyStore,
  InMemoryIdentityStore,
  InMemoryApprovalStore,
  InMemoryCartridgeRegistry,
} from "./in-memory.js";

export function createInMemoryStorage(): StorageContext {
  return {
    envelopes: new InMemoryEnvelopeStore(),
    policies: new InMemoryPolicyStore(),
    identity: new InMemoryIdentityStore(),
    approvals: new InMemoryApprovalStore(),
    cartridges: new InMemoryCartridgeRegistry(),
  };
}

/**
 * Seed storage with a default identity spec and optional policies.
 * Used by both API and chat apps during bootstrap.
 */
export async function seedDefaultStorage(
  storage: StorageContext,
  policies: Policy[] = [],
): Promise<void> {
  const now = new Date();
  await storage.identity.saveSpec({
    id: "spec_default",
    principalId: "default",
    organizationId: null,
    name: "Default User",
    description: "Default identity spec",
    riskTolerance: {
      none: "none" as const,
      low: "none" as const,
      medium: "standard" as const,
      high: "elevated" as const,
      critical: "mandatory" as const,
    },
    globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    createdAt: now,
    updatedAt: now,
  });

  for (const policy of policies) {
    await storage.policies.save(policy);
  }
}
