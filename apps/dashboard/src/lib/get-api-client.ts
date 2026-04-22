import { PrismaClient } from "@prisma/client";
import { decryptApiKey } from "./crypto";
import { SwitchboardClient } from "./api-client";
import { requireSession } from "./session";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

export async function getApiClient(): Promise<SwitchboardClient> {
  const session = await requireSession();
  const baseUrl = process.env.SWITCHBOARD_API_URL;
  if (!baseUrl) {
    throw new Error("SWITCHBOARD_API_URL environment variable is required");
  }

  const user = await prisma.dashboardUser.findUnique({
    where: { id: session.user.id },
  });

  if (user) {
    try {
      const apiKey = decryptApiKey(user.apiKeyEncrypted);
      return new SwitchboardClient(baseUrl, apiKey);
    } catch (err) {
      throw new Error(
        `Failed to decrypt API key for user ${session.user.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Dev bypass fallback: use env API key when user not found in DB
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true") {
    const fallbackKey = process.env.SWITCHBOARD_API_KEY;
    if (fallbackKey) {
      return new SwitchboardClient(baseUrl, fallbackKey);
    }
  }

  throw new Error("User not found");
}
