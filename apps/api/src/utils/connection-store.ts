import type {
  PrismaClient,
  PrismaConnectionStore as PrismaConnectionStoreType,
} from "@switchboard/db";

let _storeModule: {
  PrismaConnectionStore: new (prisma: PrismaClient) => PrismaConnectionStoreType;
} | null = null;

export async function getConnectionStore(prisma: PrismaClient): Promise<PrismaConnectionStoreType> {
  if (!_storeModule) {
    const mod = await import("@switchboard/db");
    _storeModule = { PrismaConnectionStore: mod.PrismaConnectionStore };
  }
  return new _storeModule.PrismaConnectionStore(prisma);
}
