import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import type { AdsOperatorConfig } from "@switchboard/schemas";

// TODO: Replace with DB-backed storage via getApiClient()
const configStore = new Map<string, AdsOperatorConfig>();

export async function GET() {
  try {
    const session = await requireSession();
    const config = configStore.get(session.organizationId);

    if (!config) {
      return NextResponse.json({ error: "Operator config not found" }, { status: 404 });
    }

    return NextResponse.json({ config });
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
    const body = (await request.json()) as Omit<
      AdsOperatorConfig,
      "id" | "organizationId" | "principalId" | "createdAt" | "updatedAt"
    >;

    const now = new Date();
    const config: AdsOperatorConfig = {
      ...body,
      id: crypto.randomUUID(),
      organizationId: session.organizationId,
      principalId: session.principalId,
      createdAt: now,
      updatedAt: now,
    };

    configStore.set(session.organizationId, config);

    return NextResponse.json({ config }, { status: 201 });
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
    const existing = configStore.get(session.organizationId);

    if (!existing) {
      return NextResponse.json({ error: "Operator config not found" }, { status: 404 });
    }

    const updates = (await request.json()) as Partial<
      Omit<AdsOperatorConfig, "id" | "organizationId" | "principalId" | "createdAt" | "updatedAt">
    >;

    const updated: AdsOperatorConfig = {
      ...existing,
      ...updates,
      id: existing.id,
      organizationId: existing.organizationId,
      principalId: existing.principalId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    configStore.set(session.organizationId, updated);

    return NextResponse.json({ config: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
