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
