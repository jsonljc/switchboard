import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const apiUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";
    const res = await fetch(`${apiUrl}/api/storefront/${slug}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: "Request failed" }))) as {
        error?: string;
      };
      return NextResponse.json({ error: body.error ?? "Request failed" }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
