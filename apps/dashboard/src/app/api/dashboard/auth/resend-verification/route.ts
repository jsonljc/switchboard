import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sendVerificationEmail } from "@/lib/email";
import { requireSession } from "@/lib/session";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma =
  globalForPrisma.__prisma ??
  (globalForPrisma.__prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  }));

export async function POST() {
  const session = await requireSession();
  const email = session.user.email;

  if (!email) {
    return NextResponse.json({ error: "No email on session" }, { status: 400 });
  }

  const user = await prisma.dashboardUser.findUnique({
    where: { email },
    select: { emailVerified: true },
  });

  if (user?.emailVerified) {
    return NextResponse.json({ alreadyVerified: true });
  }

  const { sent } = await sendVerificationEmail(prisma, email);
  return NextResponse.json({ sent });
}
