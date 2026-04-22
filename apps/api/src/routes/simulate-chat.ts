import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PlaybookSchema } from "@switchboard/schemas";
import Anthropic from "@anthropic-ai/sdk";

const SimulateChatRequestSchema = z.object({
  playbook: PlaybookSchema,
  userMessage: z.string().min(1).max(2000),
});

const simulateChatRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/simulate-chat", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });

    const parsed = SimulateChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request", issues: parsed.error.issues, statusCode: 400 });
    }

    const { playbook, userMessage } = parsed.data;
    const systemPrompt = buildAlexSystemPrompt(playbook);

    try {
      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const content = message.content[0];
      const alexMessage =
        content?.type === "text" ? content.text : "I'm not sure how to respond to that.";

      return reply.send({
        alexMessage,
        annotations: buildAnnotations(playbook, userMessage),
      });
    } catch (err) {
      app.log.warn({ err }, "Simulation failed");
      return reply.code(503).send({
        error: "Simulation temporarily unavailable",
        alexMessage: "",
        annotations: [],
        statusCode: 503,
      });
    }
  });
};

function buildAlexSystemPrompt(playbook: z.infer<typeof PlaybookSchema>): string {
  const parts = [
    `You are Alex, a friendly and professional AI assistant for ${playbook.businessIdentity.name || "this business"}.`,
    playbook.businessIdentity.category &&
      `The business is a ${playbook.businessIdentity.category}.`,
    playbook.businessIdentity.location && `Located in ${playbook.businessIdentity.location}.`,
  ];

  if (playbook.services.length > 0) {
    parts.push("\nServices offered:");
    for (const s of playbook.services) {
      const details = [s.name, s.price && `$${s.price}`, s.duration && `${s.duration}min`]
        .filter(Boolean)
        .join(" — ");
      parts.push(`- ${details}`);
    }
  }

  if (Object.keys(playbook.hours.schedule).length > 0) {
    parts.push("\nHours:");
    for (const [day, hours] of Object.entries(playbook.hours.schedule)) {
      parts.push(`- ${day}: ${hours}`);
    }
  }

  if (playbook.approvalMode.bookingApproval === "ask_before_booking") {
    parts.push(
      "\nWhen someone wants to book: collect their details and say you'll confirm with the owner.",
    );
  } else if (playbook.approvalMode.bookingApproval === "book_then_notify") {
    parts.push(
      "\nWhen someone wants to book: confirm the booking directly if the slot looks open.",
    );
  }

  if (playbook.escalation.triggers.length > 0) {
    parts.push(
      `\nEscalate to the owner if the conversation involves: ${playbook.escalation.triggers.join(", ")}.`,
    );
  }

  parts.push(
    "\nKeep responses concise (2-3 sentences). Be warm but professional. Never invent information not in the playbook.",
  );

  return parts.filter(Boolean).join("\n");
}

function buildAnnotations(playbook: z.infer<typeof PlaybookSchema>, userMessage: string): string[] {
  const annotations: string[] = [];
  const lower = userMessage.toLowerCase();

  if (lower.includes("book") || lower.includes("appointment") || lower.includes("schedule")) {
    annotations.push(
      `Booking mode used: ${playbook.approvalMode.bookingApproval ?? "not configured"}`,
    );
  }
  if (lower.includes("price") || lower.includes("cost") || lower.includes("how much")) {
    annotations.push(
      `Pricing mode used: ${playbook.approvalMode.pricingApproval ?? "not configured"}`,
    );
  }
  for (const trigger of playbook.escalation.triggers) {
    if (lower.includes(trigger.toLowerCase())) {
      annotations.push(`Escalation trigger matched: "${trigger}"`);
    }
  }
  if (annotations.length === 0) {
    annotations.push("Answered from playbook knowledge");
  }
  return annotations;
}

export default simulateChatRoutes;
