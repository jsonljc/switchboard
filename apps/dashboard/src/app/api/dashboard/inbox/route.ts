import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

interface BackendHandoff {
  id: string;
  sessionId: string;
  organizationId: string;
  reason: string;
  status: string;
  leadSnapshot: {
    leadId?: string;
    name?: string;
    phone?: string;
    email?: string;
    serviceInterest?: string;
    channel: string;
    source?: string;
  };
  qualificationSnapshot: {
    signalsCaptured: Record<string, unknown>;
    qualificationStage: string;
    leadScore?: number;
  };
  conversationSummary: {
    turnCount: number;
    keyTopics: string[];
    objectionHistory: string[];
    sentiment: string;
    suggestedOpening?: string;
  };
  slaDeadlineAt: string;
  createdAt: string;
  acknowledgedAt: string | null;
  conversation: {
    channel: string;
    status: string;
    lastActivityAt: string;
  } | null;
}

interface BackendResponse {
  handoffs: BackendHandoff[];
}

function transformHandoffs(data: BackendResponse) {
  const items = data.handoffs.map((h) => {
    const { conversation, ...handoffFields } = h;

    return {
      handoff: {
        id: handoffFields.id,
        sessionId: handoffFields.sessionId,
        organizationId: handoffFields.organizationId,
        reason: handoffFields.reason,
        status: handoffFields.status,
        leadSnapshot: handoffFields.leadSnapshot,
        qualificationSnapshot: handoffFields.qualificationSnapshot,
        conversationSummary: handoffFields.conversationSummary,
        slaDeadlineAt: handoffFields.slaDeadlineAt,
        createdAt: handoffFields.createdAt,
        acknowledgedAt: handoffFields.acknowledgedAt,
      },
      conversation: conversation
        ? {
            id: handoffFields.sessionId,
            threadId: handoffFields.sessionId,
            channel: conversation.channel,
            status: conversation.status,
            lastActivityAt: conversation.lastActivityAt,
          }
        : null,
      waitingSince: handoffFields.createdAt,
      slaRemaining: new Date(handoffFields.slaDeadlineAt).getTime() - Date.now(),
    };
  });

  return { items, total: items.length };
}

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = (await client.listPendingHandoffs()) as unknown as BackendResponse;
    return NextResponse.json(transformHandoffs(data));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
