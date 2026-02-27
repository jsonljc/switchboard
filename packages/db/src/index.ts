import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === "production"
        ? [{ emit: "event", level: "error" }, { emit: "event", level: "warn" }]
        : [{ emit: "stdout", level: "query" }, { emit: "stdout", level: "error" }, { emit: "stdout", level: "warn" }],
    });
    if (process.env.NODE_ENV === "production") {
      prisma.$on("error" as never, (e: unknown) => {
        console.error("[prisma] Error:", e);
      });
      prisma.$on("warn" as never, (e: unknown) => {
        console.warn("[prisma] Warning:", e);
      });
    }
  }
  return prisma;
}

export { PrismaClient };
export type { Prisma } from "@prisma/client";

export { createPrismaStorage, PrismaLedgerStorage, PrismaConnectionStore } from "./storage/index.js";
export { encryptCredentials, decryptCredentials, isEncrypted } from "./crypto/credentials.js";
