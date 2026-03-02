import { PrismaClient } from "@prisma/client";
import { decryptApiKey } from "./crypto";
import { SwitchboardClient } from "./api-client";
import { requireSession } from "./session";

const prisma = new PrismaClient();

export async function getApiClient(): Promise<SwitchboardClient> {
  const session = await requireSession();
  const baseUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";

  const user = await prisma.dashboardUser.findUnique({
    where: { id: session.user.id },
  });

  if (user) {
    const apiKey = decryptApiKey(user.apiKeyEncrypted);
    return new SwitchboardClient(baseUrl, apiKey);
  }

  // Dev bypass fallback: use env API key when user not found in DB
  if (process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true") {
    const fallbackKey = process.env.SWITCHBOARD_API_KEY;
    if (fallbackKey) {
      return new SwitchboardClient(baseUrl, fallbackKey);
    }
  }

  throw new Error("User not found");
}
