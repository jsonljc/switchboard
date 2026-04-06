import { NextResponse } from "next/server";
import {
  AgentRuntime,
  DefaultChatHandler,
  createAnthropicAdapter,
} from "@switchboard/core/agent-runtime";
import type { AgentStateStoreInterface, ActionRequestStore } from "@switchboard/core/agent-runtime";
import { requireSession } from "@/lib/session";
import { z } from "zod";

const TestChatInput = z.object({
  persona: z.object({
    businessName: z.string().min(1),
    businessType: z.string().min(1),
    productService: z.string().min(1),
    valueProposition: z.string().min(1),
    tone: z.enum(["casual", "professional", "consultative"]),
    qualificationCriteria: z.record(z.unknown()).default({}),
    disqualificationCriteria: z.record(z.unknown()).default({}),
    escalationRules: z.record(z.unknown()).default({}),
    bookingLink: z.string().nullable().default(null),
    customInstructions: z.string().nullable().default(null),
  }),
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    )
    .max(50),
});

// No-op stores — test chat doesn't persist state or queue actions
const noopStateStore: AgentStateStoreInterface = {
  get: async () => null,
  set: async () => {},
  list: async () => [],
  delete: async () => {},
};

const noopActionRequestStore: ActionRequestStore = {
  create: async () => ({ id: "noop", status: "executed" }),
  updateStatus: async () => undefined,
};

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const parsed = TestChatInput.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { persona: personaInput, messages } = parsed.data;

    // Construct temporary AgentPersona with placeholder DB fields
    const persona = {
      ...personaInput,
      id: "test-chat-persona",
      organizationId: "test-chat-org",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let capturedReply = "";

    const runtime = new AgentRuntime({
      handler: DefaultChatHandler,
      deploymentId: "test-chat",
      surface: "test_chat",
      trustScore: 100,
      trustLevel: "autonomous",
      persona,
      stateStore: noopStateStore,
      actionRequestStore: noopActionRequestStore,
      llmAdapter: createAnthropicAdapter(),
      onChatExecute: (message: string) => {
        capturedReply = message;
      },
    });

    await runtime.handleMessage({
      conversationId: "test-chat-session",
      messages,
    });

    return NextResponse.json({ reply: capturedReply });
  } catch (err) {
    console.error("Test chat error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test chat failed" },
      { status: 500 },
    );
  }
}
