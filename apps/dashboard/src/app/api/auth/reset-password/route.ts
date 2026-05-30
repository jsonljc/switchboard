// @route-class: ingress-receiver
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resetPasswordWithToken } from "@/lib/password-reset";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

export async function POST(request: NextRequest) {
  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  const password = body.password ?? "";
  if (!token) {
    return NextResponse.json({ error: "Missing or invalid reset token" }, { status: 400 });
  }

  const result = await resetPasswordWithToken(prisma, token, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
