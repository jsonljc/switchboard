import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const body = await request.json();
    const { token, phoneNumberId } = body as {
      token?: string;
      phoneNumberId?: string;
    };

    if (!token || !phoneNumberId) {
      return NextResponse.json(
        { error: "Both token and phoneNumberId are required" },
        { status: 400 },
      );
    }

    const apiUrl = process.env.SWITCHBOARD_API_URL;
    if (!apiUrl) {
      return NextResponse.json({ error: "API URL not configured" }, { status: 500 });
    }
    const res = await fetch(`${apiUrl}/api/connections/whatsapp/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, phoneNumberId }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return proxyError(err instanceof Error ? { error: err.message } : {}, 500);
  }
}
