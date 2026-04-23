import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/password";
import { provisionDashboardUser } from "@/lib/provision-dashboard-user";
import { validateRegistration } from "@/lib/register";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

export async function POST(request: NextRequest) {
  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  if (launchMode !== "beta") {
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

  const existing = await prisma.dashboardUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  const dashboardUser = await provisionDashboardUser(prisma, {
    email,
    name: null,
    emailVerified: null,
  });

  await prisma.dashboardUser.update({
    where: { id: dashboardUser.id },
    data: { passwordHash },
  });

  return NextResponse.json(
    {
      id: dashboardUser.id,
      email: dashboardUser.email,
      organizationId: dashboardUser.organizationId,
    },
    { status: 201 },
  );
}
