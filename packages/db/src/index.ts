import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export { PrismaClient };
export type { Prisma } from "@prisma/client";

export { createPrismaStorage, PrismaLedgerStorage, PrismaConnectionStore } from "./storage/index.js";
export { encryptCredentials, decryptCredentials, isEncrypted } from "./crypto/credentials.js";
