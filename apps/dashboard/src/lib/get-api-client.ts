import { PrismaClient } from "@prisma/client";
import { decryptApiKey } from "./crypto";
import { SwitchboardClient } from "./api-client";
import { requireSession } from "./session";

const prisma = new PrismaClient();

export async function getApiClient(): Promise<SwitchboardClient> {
  const session = await requireSession();
  const user = await prisma.dashboardUser.findUnique({
    where: { id: session.user.id },
  });
  if (!user) throw new Error("User not found");

  const apiKey = decryptApiKey(user.apiKeyEncrypted);
  const baseUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";

  return new SwitchboardClient(baseUrl, apiKey);
}
