import { NextResponse } from "next/server";

export function proxyError(backendBody: unknown, fallbackStatus: number): NextResponse {
  const body =
    backendBody && typeof backendBody === "object" && "error" in backendBody
      ? (backendBody as { error: string; statusCode?: number })
      : null;

  const error = body?.error || "Request failed";
  const statusCode = body?.statusCode || fallbackStatus;

  return NextResponse.json({ error, statusCode }, { status: statusCode });
}
