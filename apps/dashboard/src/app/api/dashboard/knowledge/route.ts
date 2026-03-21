import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId") ?? undefined;
    const result = await client.listKnowledgeDocuments(agentId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json({ error: "documentId required" }, { status: 400 });
    }
    const result = await client.deleteKnowledgeDocument(documentId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
