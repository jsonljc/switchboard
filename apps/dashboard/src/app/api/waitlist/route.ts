import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body?.email ?? "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    // Try to persist to DB if Prisma is available
    try {
      // Dynamic import to avoid breaking if DB is not set up
      const { getDb } = await import("@switchboard/db");
      const db = getDb();

      // @ts-expect-error — WaitlistEntry model added via migration, may not be in generated types yet
      await db.waitlistEntry.create({ data: { email } });

      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (dbError: unknown) {
      // If it's a unique constraint violation (duplicate email), treat as success
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      if (msg.includes("Unique constraint") || msg.includes("P2002")) {
        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }

      console.warn("[waitlist] persistence failed:", msg);
      return NextResponse.json(
        { ok: false, error: "Waitlist signup is temporarily unavailable" },
        { status: 503 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
