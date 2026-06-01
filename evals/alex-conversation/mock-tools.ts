import { ok } from "@switchboard/core/skill-runtime";
import type { SkillTool, ToolResult } from "@switchboard/core/skill-runtime";

/**
 * One recorded tool invocation. The grader uses these to assert tool usage and
 * ordering (e.g. "qualify before booking" — `crm-write.stage.update` /
 * `crm-query.contact.get` must appear before `calendar-book.booking.create`).
 */
export interface RecordedToolCall {
  /** Tool id, e.g. "calendar-book". */
  toolId: string;
  /** Operation name, e.g. "booking.create". */
  operation: string;
  /** Fully-qualified name as the model issued it, e.g. "calendar-book.booking.create". */
  name: string;
  /** Raw params the model supplied. */
  params: unknown;
  /** Monotonic call index across ALL tools in this conversation (0-based). */
  order: number;
}

/**
 * A `Map<string, SkillTool>` of benign, deterministic mock tools plus a `calls`
 * array that records every operation invocation in order.
 *
 * The tool ids, operation names, effect categories, and input schemas mirror the
 * real Alex tools (crm-query / crm-write / calendar-book / escalate / follow-up) so the LLM
 * sees the same tool definitions production registers — but every `execute`
 * returns a benign `ok(...)` and performs no side effects. Because the eval
 * executor runs with NO governance hooks, write/external_mutation operations are
 * NOT gated here; the mocks simply succeed and record the call.
 */
export interface MockTools {
  tools: Map<string, SkillTool>;
  calls: RecordedToolCall[];
}

export function createMockTools(): MockTools {
  const calls: RecordedToolCall[] = [];

  const record = (toolId: string, operation: string, params: unknown): void => {
    calls.push({
      toolId,
      operation,
      name: `${toolId}.${operation}`,
      params,
      order: calls.length,
    });
  };

  const recordingOp = (
    toolId: string,
    operation: string,
    description: string,
    effectCategory: "read" | "write" | "external_mutation",
    inputSchema: Record<string, unknown>,
    data: () => Record<string, unknown> | undefined,
    idempotent = true,
  ): SkillTool["operations"][string] => ({
    description,
    effectCategory,
    idempotent,
    inputSchema,
    execute: async (params: unknown): Promise<ToolResult> => {
      record(toolId, operation, params);
      return ok(data());
    },
  });

  const crmQuery: SkillTool = {
    id: "crm-query",
    operations: {
      "contact.get": recordingOp(
        "crm-query",
        "contact.get",
        "Get a contact by ID. Returns name, phone, email, stage, source.",
        "read",
        {
          type: "object",
          properties: {
            contactId: { type: "string", description: "Contact UUID" },
            orgId: { type: "string", description: "Organization ID" },
          },
          required: ["contactId", "orgId"],
        },
        () => ({
          id: "mock-contact",
          name: null,
          phone: null,
          email: null,
          stage: "interested",
          source: "whatsapp",
        }),
      ),
      "activity.list": recordingOp(
        "crm-query",
        "activity.list",
        "List recent activity logs for a deployment.",
        "read",
        {
          type: "object",
          properties: {
            orgId: { type: "string" },
            deploymentId: { type: "string" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
          required: ["orgId", "deploymentId"],
        },
        () => ({ activities: [] }),
      ),
    },
  };

  const crmWrite: SkillTool = {
    id: "crm-write",
    operations: {
      "stage.update": recordingOp(
        "crm-write",
        "stage.update",
        "Update an opportunity's pipeline stage.",
        "write",
        {
          type: "object",
          properties: {
            opportunityId: { type: "string", description: "Opportunity UUID" },
            stage: {
              type: "string",
              enum: [
                "interested",
                "qualified",
                "quoted",
                "booked",
                "showed",
                "won",
                "lost",
                "nurturing",
              ],
            },
          },
          required: ["opportunityId", "stage"],
        },
        () => ({ ok: true }),
      ),
      "activity.log": recordingOp(
        "crm-write",
        "activity.log",
        "Log an activity event.",
        "write",
        {
          type: "object",
          properties: {
            eventType: { type: "string", description: "e.g. opt-out, qualification, handoff" },
            description: { type: "string" },
          },
          required: ["eventType", "description"],
        },
        () => undefined,
        false,
      ),
    },
  };

  const calendarBook: SkillTool = {
    id: "calendar-book",
    operations: {
      "slots.query": recordingOp(
        "calendar-book",
        "slots.query",
        "Query available calendar slots for a date range.",
        "read",
        {
          type: "object",
          properties: {
            dateFrom: { type: "string", description: "ISO 8601 start date" },
            dateTo: { type: "string", description: "ISO 8601 end date" },
            durationMinutes: { type: "number", description: "Appointment duration in minutes" },
            service: { type: "string", description: "Service type" },
            timezone: { type: "string", description: "IANA timezone" },
          },
          required: ["dateFrom", "dateTo", "durationMinutes", "service", "timezone"],
        },
        () => ({
          slots: [
            { start: "2026-06-01T02:00:00.000Z", end: "2026-06-01T03:00:00.000Z" },
            { start: "2026-06-01T06:00:00.000Z", end: "2026-06-01T07:00:00.000Z" },
          ],
        }),
      ),
      "booking.create": recordingOp(
        "calendar-book",
        "booking.create",
        "Book a calendar slot for a contact. Persists booking, creates calendar event, emits booked event via outbox.",
        "external_mutation",
        {
          type: "object",
          properties: {
            contactId: { type: "string" },
            service: { type: "string" },
            slotStart: { type: "string", description: "ISO 8601" },
            slotEnd: { type: "string", description: "ISO 8601" },
            calendarId: { type: "string" },
            attendeeName: { type: "string" },
            attendeeEmail: { type: "string" },
          },
          required: ["contactId", "service", "slotStart", "slotEnd", "calendarId"],
        },
        () => ({ bookingId: "mock-booking", status: "booked" }),
      ),
    },
  };

  const escalate: SkillTool = {
    id: "escalate",
    operations: {
      "handoff.create": recordingOp(
        "escalate",
        "handoff.create",
        "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, or when the customer is frustrated.",
        "write",
        {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "human_requested",
                "missing_knowledge",
                "complex_objection",
                "negative_sentiment",
                "compliance_concern",
                "booking_failure",
                "max_turns_exceeded",
              ],
            },
            summary: {
              type: "string",
              description: "Brief summary of why escalation is needed and what the customer wants",
            },
            customerSentiment: {
              type: "string",
              enum: ["positive", "neutral", "frustrated", "angry"],
            },
          },
          required: ["reason", "summary"],
        },
        () => ({ handoffId: "mock-handoff", status: "pending" }),
        false,
      ),
    },
  };

  // Mirrors the real `follow-up` tool (skills/alex/SKILL.md + core
  // skill-runtime/tools/schedule-follow-up.ts): id, operation name, effect
  // category, and input schema match so the executor offers the same definition
  // production registers. The mock only records the call (no scheduling).
  const followUp: SkillTool = {
    id: "follow-up",
    operations: {
      "followup.schedule": recordingOp(
        "follow-up",
        "followup.schedule",
        "Schedule a single WhatsApp re-engagement follow-up for this lead, to be sent automatically later (only if consent, the messaging window, and an approved template all allow). Use when a qualified lead has gone quiet or hesitant. Do not schedule more than one follow-up per conversation.",
        "write",
        {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "hesitation",
                "price_concern",
                "timing_not_now",
                "awaiting_info",
                "went_quiet",
              ],
            },
            delay: {
              type: "string",
              enum: ["in_1_day", "in_3_days", "in_1_week"],
            },
            note: {
              type: "string",
              description: "Optional short context for the team (not sent to the customer).",
            },
          },
          required: ["reason", "delay"],
        },
        () => ({
          followUpId: "mock-followup",
          scheduledFor: "2026-06-04T00:00:00.000Z",
          status: "scheduled",
        }),
      ),
    },
  };

  const tools = new Map<string, SkillTool>([
    ["crm-query", crmQuery],
    ["crm-write", crmWrite],
    ["calendar-book", calendarBook],
    ["escalate", escalate],
    ["follow-up", followUp],
  ]);

  return { tools, calls };
}
