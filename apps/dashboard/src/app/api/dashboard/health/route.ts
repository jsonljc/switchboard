import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, string> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: `${process.uptime().toFixed(0)}s`,
  };

  // Check backend reachability (unauthenticated ping)
  const apiUrl = process.env.SWITCHBOARD_API_URL;
  if (!apiUrl) {
    checks.backend = "unconfigured";
  } else {
    try {
      const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
      checks.backend = res.ok ? "reachable" : `status_${res.status}`;
    } catch {
      checks.backend = "unreachable";
    }
  }

  return NextResponse.json(checks);
}
