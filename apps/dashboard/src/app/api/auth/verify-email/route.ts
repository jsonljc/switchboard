import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verifyEmailToken } from "@/lib/email";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const email = request.nextUrl.searchParams.get("email");

  if (!token || !email) {
    return NextResponse.redirect(new URL("/login?error=invalid-verification-link", request.url));
  }

  const result = await verifyEmailToken(prisma, email, token);

  if (!result.verified) {
    const errorParam = encodeURIComponent(result.error || "Verification failed");
    return NextResponse.redirect(new URL(`/login?error=${errorParam}`, request.url));
  }

  return NextResponse.redirect(new URL("/login?verified=true", request.url));
}
