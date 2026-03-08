import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const session = await requireSession();
    const client = await getApiClient();

    try {
      const result = await client.getOperatorConfig(session.organizationId);
      return NextResponse.json({ config: result.config });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // Treat "not found" from API as 404
      if (message.includes("404") || message.includes("not found")) {
        return NextResponse.json({ error: "Operator config not found" }, { status: 404 });
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const client = await getApiClient();

    const result = await client.createOperatorConfig({
      ...body,
      organizationId: session.organizationId,
      principalId: session.principalId,
      active: body.active ?? true,
    });

    return NextResponse.json({ config: result.config }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    const updates = await request.json();
    const client = await getApiClient();

    try {
      const result = await client.updateOperatorConfig(session.organizationId, updates);
      return NextResponse.json({ config: result.config });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("404") || message.includes("not found")) {
        return NextResponse.json({ error: "Operator config not found" }, { status: 404 });
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
