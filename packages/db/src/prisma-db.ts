import type { PrismaClient, Prisma } from "@prisma/client";

/** Prisma root client or interactive transaction client (same model delegates). */
export type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

export function isRootPrismaClient(client: PrismaDbClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}
