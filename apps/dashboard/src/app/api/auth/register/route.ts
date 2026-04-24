import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/password";
import { provisionDashboardUser } from "@/lib/provision-dashboard-user";
import { validateRegistration } from "@/lib/register";
import { sendVerificationEmail, checkRegistrationRateLimit } from "@/lib/email";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

const OPEN_MODES = new Set(["beta", "public"]);

export async function POST(request: NextRequest) {
  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  if (!OPEN_MODES.has(launchMode)) {
    return NextResponse.json(
      { error: "Registration is not available. Join the waitlist instead." },
      { status: 403 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const validation = validateRegistration(email, password);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const withinLimit = await checkRegistrationRateLimit(prisma, email);
  if (!withinLimit) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429 },
    );
  }

  const passwordHash = await hashPassword(password);

  let dashboardUser;
  try {
    dashboardUser = await provisionDashboardUser(prisma, {
      email,
      name: null,
      emailVerified: null,
    });

    await prisma.dashboardUser.update({
      where: { id: dashboardUser.id },
      data: { passwordHash },
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }
    throw err;
  }

  const { sent } = await sendVerificationEmail(prisma, email);

  return NextResponse.json(
    {
      id: dashboardUser.id,
      email: dashboardUser.email,
      organizationId: dashboardUser.organizationId,
      verificationEmailSent: sent,
    },
    { status: 201 },
  );
}
