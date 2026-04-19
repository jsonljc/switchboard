import { NextRequest, NextResponse } from "next/server";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const deployment = await client.getDeployment(id);
    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }
    const facts = await client.getBusinessFacts(deployment.organizationId);
    return NextResponse.json({ facts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const deployment = await client.getDeployment(id);
    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = BusinessFactsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await client.upsertBusinessFacts(deployment.organizationId, parsed.data);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
