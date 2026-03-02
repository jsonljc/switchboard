import type { PrismaClient } from "@prisma/client";
import type { StorageContext } from "@switchboard/core";
import { InMemoryCartridgeRegistry } from "@switchboard/core";
import { PrismaEnvelopeStore } from "./prisma-envelope-store.js";
import { PrismaPolicyStore } from "./prisma-policy-store.js";
import { PrismaIdentityStore } from "./prisma-identity-store.js";
import { PrismaApprovalStore } from "./prisma-approval-store.js";
import { PrismaCompetenceStore } from "./prisma-competence-store.js";

export function createPrismaStorage(prisma: PrismaClient): StorageContext {
  return {
    envelopes: new PrismaEnvelopeStore(prisma),
    policies: new PrismaPolicyStore(prisma),
    identity: new PrismaIdentityStore(prisma),
    approvals: new PrismaApprovalStore(prisma),
    cartridges: new InMemoryCartridgeRegistry(),
    competence: new PrismaCompetenceStore(prisma),
  };
}
