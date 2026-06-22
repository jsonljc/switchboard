import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaReceiptedBookingStore, PrismaReceiptStore } from "@switchboard/db";
import { SkillExecutorImpl, GovernanceHook } from "@switchboard/core/skill-runtime";
import type { SkillDefinition, SkillTool } from "@switchboard/core/skill-runtime";
import { buildTestServer, type TestContext } from "./test-server.js";
import { InMemoryRevenueDb, buildCalendarBookTool } from "./revenue-loop-substrate.js";

/**
 * Capstone of the whole-loop revenue-proof e2e (decomposition plan:
 * docs/superpowers/plans/2026-06-21-revenue-proof-e2e-decomposition.md).
 *
 * The gap this closes: slices 1-3 (revenue-proof-e2e.test.ts and friends) invoke the calendar-book
 * `booking.create` OPERATION directly (`tool.operations["booking.create"].execute(...)`), bypassing the
 * skill executor and its governance layer entirely. So the producer-to-owner-tile data plane was proven
 * end-to-end, but the CONVERSATION ENTRY into that producer was not: nothing proved that a STUBBED LLM
 * emitting a `calendar-book.booking.create` tool-call actually dispatches through the REAL
 * `SkillExecutorImpl` (name resolution -> input-schema validation -> the REAL `GovernanceHook`) to the
 * REAL booking op, over the same in-memory substrate, and threads the booking to the owner number.
 *
 * This test runs that executor dispatch + governance layer over the real op. Mocked external edges ONLY:
 * the LLM (a scripted stub adapter — the ONLY fake on the reasoning plane), Google Calendar (a stub
 * provider inside the substrate), and Prisma (the in-memory substrate). The executor, the governance
 * hook, the booking op, the Receipt mint, and every projection read back are production code.
 *
 * GOVERNANCE IS LOAD-BEARING (see the supervised-trust note below): `booking.create` is an
 * `external_mutation`, which the GOVERNANCE_POLICY table PARKS (require-approval) at "supervised". Only
 * the op's `governanceOverride: { supervised: "auto-approve" }` lets it run. Driving the executor at
 * trustLevel "supervised" (NOT "autonomous") makes this test RED the instant that override is removed
 * (the hook would return pending_approval -> the op never executes -> no booking -> the owner tile is
 * empty). The exact source mutation that reds it is documented in the loop ledger.
 *
 * Time is frozen (Date only) to a fixed mid-week instant so the booked calendar receipt's createdAt
 * lands deterministically inside the route's THIS WEEK [startOfWeekUTC, +7d) window. Values mirror
 * slice 1 exactly so both tests assert against the same owner-tile contract.
 */

const ORG = "org-1";
// Wednesday 2026-06-17 12:00 UTC: comfortably inside THIS WEEK [Mon 2026-06-15, Mon 2026-06-22).
const FROZEN_NOW = new Date("2026-06-17T12:00:00.000Z");
const SLOT_START = "2026-06-17T14:00:00.000Z";
const SLOT_END = "2026-06-17T15:00:00.000Z";
const EXPECTED_VALUE_CENTS = 45000;

/** The exact tool-call the executor must resolve, validate, govern, and dispatch (mirrors the op's
 *  declared inputSchema: service/slotStart/slotEnd/calendarId, no trust-bound identifiers). */
const BOOKING_INPUT = {
  service: "Botox consult",
  slotStart: SLOT_START,
  slotEnd: SLOT_END,
  calendarId: "cal-1",
};

/** Minimal Alex-shaped skill: declares the calendar-book tool so the executor builds its tool
 *  definitions and resolves dispatch against it. The body never reaches the (stubbed) LLM's behavior —
 *  the stub scripts the tool-call directly — but it keeps the skill realistic. */
const SKILL: SkillDefinition = {
  slug: "alex-test",
  name: "Alex Test",
  version: "1.0.0",
  description: "test",
  author: "test",
  body: "You are Alex. Use calendar-book to book.",
  parameters: [],
  tools: ["calendar-book"],
  context: [],
};

/**
 * Local structural mirror of core's internal LLMResponse (its `llm-types.ts` is not on the public
 * `@switchboard/core/skill-runtime` export surface). camelCase `usage.inputTokens`/`outputTokens`
 * matches the contract the executor reads; the object the stub returns is structurally assignable to the
 * executor's `ToolCallingLLMAdapter` constructor argument.
 */
interface StubLLMResponse {
  content: Array<
    { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stopReason: "tool_use" | "end_turn" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Scripted tool-calling LLM stub. Returns the queued responses in order and advances per call; throws
 * if the executor asks for more turns than scripted (a real bug — the loop should end after the final
 * end_turn). Accepts (and ignores) the executor's per-call `signal` — it never hangs, so the abort
 * deadline never fires. Typed structurally so it satisfies the executor's adapter argument without
 * reaching into core's internal llm-types.
 */
function createStubAdapter(responses: StubLLMResponse[]): {
  chatWithTools: () => Promise<StubLLMResponse>;
} {
  let callIndex = 0;
  return {
    chatWithTools: async (): Promise<StubLLMResponse> => {
      const resp = responses[callIndex];
      if (!resp) {
        throw new Error(
          `stub adapter exhausted: executor requested turn ${callIndex + 1}, only ${responses.length} scripted`,
        );
      }
      callIndex += 1;
      return resp;
    },
  };
}

const USAGE = { inputTokens: 100, outputTokens: 50 };

/** A two-turn script: turn 1 emits the named tool-call (stopReason "tool_use"); the executor injects the
 *  tool result and calls again, so turn 2 ends the loop (stopReason "end_turn"). */
function scriptToolCall(toolName: string): StubLLMResponse[] {
  return [
    {
      content: [{ type: "tool_use", id: "t1", name: toolName, input: BOOKING_INPUT }],
      stopReason: "tool_use",
      usage: USAGE,
    },
    {
      content: [{ type: "text", text: "Booked" }],
      stopReason: "end_turn",
      usage: USAGE,
    },
  ];
}

describe("revenue-proof e2e capstone: conversation -> booking ENTRY through the real skill executor", () => {
  let ctx: TestContext;
  let db: InMemoryRevenueDb;

  beforeEach(async () => {
    // Fake ONLY Date (leave timers real) so Fastify's async internals are unaffected.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
    ctx = await buildTestServer();
    db = new InMemoryRevenueDb();
    // A deterministic-attribution lead (leadgenId present) with a priced active opportunity, no PDPA
    // jurisdiction (so no missing_consent exception): the cleanest "perfect" receipted booking. Mirrors
    // slice 1's seed so both tests assert the same owner-tile numbers.
    db.seedContact({
      id: "ct-1",
      organizationId: ORG,
      leadgenId: "lead-1",
      sourceType: null,
      firstTouchChannel: null,
      pdpaJurisdiction: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
      name: "Test Patient",
      email: null,
    });
    db.seedOpportunity({
      id: "opp-1",
      organizationId: ORG,
      contactId: "ct-1",
      estimatedValue: EXPECTED_VALUE_CENTS,
      stage: "qualified",
    });
  });

  afterEach(async () => {
    await ctx.app.close();
    vi.useRealTimers();
  });

  /**
   * Build the executor over the REAL pre-built calendar-book tool (so the op keeps the substrate ctx,
   * including contactId="ct-1") and the REAL GovernanceHook over the same tool map. The pre-built tool
   * is registered in the base `tools` map — NOT via toolFactories — because the executor would re-derive
   * the request context's contactId from the LLM-supplied parameter bag (composeSkillRequestContext),
   * which is empty here; the pre-built op's closed-over ctx is the trusted server identity slice 1 uses.
   */
  function buildExecutor(responses: StubLLMResponse[]): SkillExecutorImpl {
    const tool = buildCalendarBookTool(db, {
      sessionId: "s",
      orgId: ORG,
      deploymentId: "dep-1",
      contactId: "ct-1",
    });
    const tools = new Map<string, SkillTool>([["calendar-book", tool]]);
    return new SkillExecutorImpl(createStubAdapter(responses), tools, undefined, [
      new GovernanceHook(tools),
    ]);
  }

  /** Drive the executor at supervised trust (the override is what lets booking.create run). */
  function runConversation(executor: SkillExecutorImpl) {
    return executor.execute({
      skill: SKILL,
      parameters: {},
      messages: [{ role: "user", content: "Book me a Botox consult" }],
      deploymentId: "dep-1",
      orgId: ORG,
      trustScore: 50,
      trustLevel: "supervised",
    });
  }

  /** Wire the route's receipted-booking stores to the REAL projections over the SAME substrate, then GET
   *  the owner report (mirrors slice 1's app.ts wiring + the THIS WEEK window). */
  function wireRouteAndGetReport() {
    const receiptedStore = new PrismaReceiptedBookingStore(db.client as never);
    const receiptStore = new PrismaReceiptStore(db.client as never);
    ctx.app.reportStores!.receiptedBookings = {
      listForCohort: (input) => receiptedStore.listForCohort(input.orgId, input.from, input.to),
    };
    ctx.app.reportStores!.receipts = {
      countReceiptedBookingsInWindow: (input) => receiptStore.countReceiptedBookingsInWindow(input),
    };
    return ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20WEEK",
      headers: { "x-org-id": ORG },
    });
  }

  it("dispatches the LLM's booking.create through governance to the real op and surfaces the owner tile", async () => {
    const executor = buildExecutor(scriptToolCall("calendar-book.booking.create"));
    const result = await runConversation(executor);

    // The executor resolved the tool by name, validated input, governed it, and dispatched the REAL op.
    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0]!;
    expect(call.toolId).toBe("calendar-book");
    expect(call.operation).toBe("booking.create");
    // Load-bearing: at supervised trust ONLY the op's governanceOverride auto-approves an
    // external_mutation. Remove it and this becomes "require-approval" -> pending_approval -> no booking.
    expect(call.governanceDecision).toBe("auto-approved");
    expect(call.result.status).toBe("success");

    // Read back through the SAME projection -> rollup -> owner-tile path slice 1 uses. The booking the
    // executor dispatched populates the real PrismaReceiptedBookingStore / PrismaReceiptStore projections.
    const res = await wireRouteAndGetReport();
    expect(res.statusCode).toBe(200);

    // Owner revenue tile: exactly the one booking, expected value flows from the issued snapshot, no
    // payment receipt yet -> proven-paid is zero.
    expect(res.json().receiptedBookings).toMatchObject({ count: 1 });
    expect(res.json().receiptedBookingRevenue).toMatchObject({
      cohortSize: 1,
      bookingsWithValue: 1,
      revenueCents: EXPECTED_VALUE_CENTS,
      paidRevenueCents: 0,
      paidBookings: 0,
    });

    // Owner quality tile: deterministic attribution, zero exceptions, nothing needing attention.
    const quality = res.json().receiptedBookingQuality;
    expect(quality.cohortSize).toBe(1);
    expect(quality.confidence).toMatchObject({
      deterministic: 1,
      high: 0,
      medium: 0,
      low: 0,
      unattributed: 0,
    });
    expect(quality.bookingsNeedingAttention).toBe(0);
  });

  it("does NOT execute a booking when the LLM emits a mis-keyed op name (real name resolution)", async () => {
    // The stub emits a typo'd op name. The executor splits on "." -> toolId "calendar-book",
    // operation "booking.created" -> tool.operations["booking.created"] is undefined -> it short-circuits
    // to a structured TOOL_NOT_FOUND result and NEVER calls execute(). This guards the silent-inertness
    // scenario where an op key is renamed and the dispatch resolves nothing.
    const executor = buildExecutor(scriptToolCall("calendar-book.booking.created"));
    const result = await runConversation(executor);

    // Observed real behavior: the executor DOES push a toolCall record for the unknown op, with a
    // status:"error" TOOL_NOT_FOUND result. (Its governanceDecision is "auto-approved" — the executor's
    // default for the no-op branch, because the GovernanceHook only decides when the op resolves; for an
    // unknown op it logs nothing and proceeds. So the load-bearing assertion is the error status + the
    // empty substrate below, NOT the governance label.)
    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0]!;
    expect(call.result.status).not.toBe("success");
    expect(call.result.status).toBe("error");
    expect(call.result.error?.code).toBe("TOOL_NOT_FOUND");

    // The op never ran: zero bookings AND zero receipts in the substrate, and the owner tile is empty.
    expect(db.listReceipts().filter((r) => r.organizationId === ORG)).toHaveLength(0);
    const res = await wireRouteAndGetReport();
    expect(res.statusCode).toBe(200);
    expect(res.json().receiptedBookings).toMatchObject({ count: 0 });
    expect(res.json().receiptedBookingRevenue).toMatchObject({ cohortSize: 0 });
  });
});
