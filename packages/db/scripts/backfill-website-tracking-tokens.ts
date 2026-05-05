import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
}

export async function backfillWebsiteTrackingTokens(
  prisma: Pick<PrismaClient, "organizationConfig">,
): Promise<BackfillResult> {
  const rows = await prisma.organizationConfig.findMany({
    select: { id: true, websiteTrackingToken: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.websiteTrackingToken) {
      skipped += 1;
      continue;
    }
    const token = randomBytes(32).toString("hex");
    await prisma.organizationConfig.update({
      where: { id: row.id },
      data: { websiteTrackingToken: token },
    });
    updated += 1;
  }

  return { scanned: rows.length, updated, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const result = await backfillWebsiteTrackingTokens(prisma);
      console.warn(
        `[backfill-website-tracking-tokens] scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped}`,
      );
    } finally {
      await prisma.$disconnect();
    }
  })();
}
