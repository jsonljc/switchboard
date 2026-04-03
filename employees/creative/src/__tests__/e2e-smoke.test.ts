/**
 * End-to-end smoke test for the Creative employee.
 *
 * Tests the full lifecycle:
 * 1. defineEmployee() compiles correctly
 * 2. content.requested → draft action + draft_ready event
 * 3. content.approved → publish action
 * 4. content.rejected → learn() called + revise action + draft_ready event
 * 5. content.performance_updated → pattern learning on high engagement
 * 6. employee.onboarded → calendar suggestions
 * 7. Governance: creative.content.publish requires approval
 * 8. Cartridge executes actions via Zod-validated executors
 */

import { describe, it, expect, vi } from "vitest";
import creative from "../../src/index.js";
import { createEventEnvelope, CREATIVE_EVENTS } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";

// Raw handlers for behavior testing (compiled handler uses placeholder ctx)
import { handleContentRequested } from "../../src/handlers/content-requested.js";
import { handleContentRejected } from "../../src/handlers/content-rejected.js";
import { handleContentApproved } from "../../src/handlers/content-approved.js";
import { handlePerformanceUpdated } from "../../src/handlers/performance-updated.js";
import { handleOnboarded } from "../../src/handlers/onboarded.js";

// ---------------------------------------------------------------------------
// Mock context factory
// ---------------------------------------------------------------------------

function createMockContext(overrides?: Partial<EmployeeContext>): EmployeeContext {
  return {
    organizationId: "org-smoke-test",
    knowledge: { search: vi.fn().mockResolvedValue([]) },
    memory: {
      brand: {
        search: vi
          .fn()
          .mockResolvedValue([
            { content: "Professional tone, concise messaging.", similarity: 0.9 },
          ]),
      },
      skills: {
        getRelevant: vi
          .fn()
          .mockResolvedValue([{ pattern: "Keep LinkedIn posts under 300 words.", score: 0.85 }]),
      },
      performance: {
        getTop: vi.fn().mockResolvedValue([]),
      },
    },
    llm: {
      generate: vi.fn().mockResolvedValue({ text: "AI is transforming how businesses operate." }),
    },
    actions: {
      propose: vi.fn().mockResolvedValue({
        success: true,
        summary: "ok",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      }),
    },
    emit: vi.fn(),
    learn: vi.fn().mockResolvedValue(undefined),
    personality: { toPrompt: () => "You are a creative content strategist." },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Compilation
// ---------------------------------------------------------------------------

describe("Creative employee E2E", () => {
  describe("compilation", () => {
    it("defineEmployee() produces a valid CompiledEmployee", () => {
      expect(creative.port.agentId).toBe("creative");
      expect(creative.port.version).toBe("1.0.0");
      expect(creative.port.inboundEvents).toContain(CREATIVE_EVENTS.CONTENT_REQUESTED);
      expect(creative.port.outboundEvents).toContain(CREATIVE_EVENTS.CONTENT_DRAFT_READY);
      expect(creative.handler).toBeDefined();
      expect(creative.cartridge).toBeDefined();
      expect(creative.defaults).toBeDefined();
    });

    it("cartridge manifest has correct actions", () => {
      const manifest = creative.cartridge.manifest;
      expect(manifest.id).toBe("creative");
      expect(manifest.actions).toHaveLength(7);

      const actionTypes = manifest.actions.map((a) => a.actionType);
      expect(actionTypes).toContain("creative.content.draft");
      expect(actionTypes).toContain("creative.content.publish");
      expect(actionTypes).toContain("creative.calendar.plan");
    });

    it("cartridge policies include require_approval for publish", () => {
      const policies = creative.defaults.policies;
      const publishPolicy = policies.find((p) => p.action === "creative.content.publish");
      expect(publishPolicy?.effect).toBe("require_approval");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. content.requested → draft action + draft_ready event
  // ---------------------------------------------------------------------------

  describe("content.requested flow", () => {
    it("generates content and returns draft action + draft_ready event", async () => {
      const ctx = createMockContext();
      const event = createEventEnvelope({
        eventType: CREATIVE_EVENTS.CONTENT_REQUESTED,
        organizationId: "org-smoke-test",
        source: { type: "manual", id: "user-1" },
        payload: { channel: "linkedin", format: "post", topic: "AI trends in 2026" },
      });

      const result = await handleContentRequested(event, ctx);

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]!.type).toBe("creative.content.draft");
      expect(result.actions[0]!.params.content).toBe("AI is transforming how businesses operate.");
      expect(result.actions[0]!.params.channel).toBe("linkedin");

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe("content.draft_ready");

      expect(ctx.memory.brand.search).toHaveBeenCalled();
      expect(ctx.memory.skills.getRelevant).toHaveBeenCalledWith("content_creation", "post", 3);
      expect(ctx.llm.generate).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. content.approved → publish action
  // ---------------------------------------------------------------------------

  describe("content.approved flow", () => {
    it("returns publish action for approved content", async () => {
      const ctx = createMockContext();
      const event = createEventEnvelope({
        eventType: CREATIVE_EVENTS.CONTENT_APPROVED,
        organizationId: "org-smoke-test",
        source: { type: "manual", id: "reviewer-1" },
        payload: { draftId: "draft-123", channel: "linkedin" },
      });

      const result = await handleContentApproved(event, ctx);

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]!.type).toBe("creative.content.publish");
      expect(result.actions[0]!.params.draftId).toBe("draft-123");
      expect(ctx.learn).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. content.rejected → learn() + revise action
  // ---------------------------------------------------------------------------

  describe("content.rejected flow", () => {
    it("learns from rejection and generates revised content", async () => {
      const ctx = createMockContext();
      const event = createEventEnvelope({
        eventType: CREATIVE_EVENTS.CONTENT_REJECTED,
        organizationId: "org-smoke-test",
        source: { type: "manual", id: "reviewer-1" },
        payload: {
          draftId: "draft-123",
          content: "Original content that was too long.",
          channel: "linkedin",
          format: "post",
          feedback: "Too verbose. Keep it under 200 words.",
        },
      });

      const result = await handleContentRejected(event, ctx);

      // Should call learn() with rejection data
      expect(ctx.learn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rejection",
          feedback: "Too verbose. Keep it under 200 words.",
          channel: "linkedin",
        }),
      );

      // Should produce revise action
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]!.type).toBe("creative.content.revise");
      expect(result.actions[0]!.params.originalDraftId).toBe("draft-123");

      // Should emit draft_ready event for the revision
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe("content.draft_ready");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. content.performance_updated → skill learning
  // ---------------------------------------------------------------------------

  describe("content.performance_updated flow", () => {
    it("learns pattern when engagement is high", async () => {
      const ctx = createMockContext({
        llm: {
          generate: vi.fn().mockResolvedValue({
            text: "Short posts with questions drive 3x engagement on LinkedIn.",
          }),
        },
      });

      const event = createEventEnvelope({
        eventType: CREATIVE_EVENTS.CONTENT_PERFORMANCE_UPDATED,
        organizationId: "org-smoke-test",
        source: { type: "system", id: "analytics" },
        payload: {
          contentId: "content-456",
          channel: "linkedin",
          metrics: { likes: 150, comments: 42, shares: 28, impressions: 5000 },
        },
      });

      await handlePerformanceUpdated(event, ctx);

      // Should learn the pattern since engagement > 100
      expect(ctx.learn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "performance_pattern",
          evidence: ["content-456"],
          channel: "linkedin",
        }),
      );
    });

    it("does NOT learn pattern when engagement is low", async () => {
      const ctx = createMockContext();
      const event = createEventEnvelope({
        eventType: CREATIVE_EVENTS.CONTENT_PERFORMANCE_UPDATED,
        organizationId: "org-smoke-test",
        source: { type: "system", id: "analytics" },
        payload: {
          contentId: "content-789",
          channel: "twitter",
          metrics: { likes: 5, comments: 1, shares: 0 },
        },
      });

      await handlePerformanceUpdated(event, ctx);

      expect(ctx.learn).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. employee.onboarded → calendar suggestions
  // ---------------------------------------------------------------------------

  describe("employee.onboarded flow", () => {
    it("generates initial content calendar suggestions", async () => {
      const ctx = createMockContext({
        llm: {
          generate: vi.fn().mockResolvedValue({
            text: "Week 1: Intro post. Week 2: Industry insight. Week 3: Case study.",
          }),
        },
      });

      const event = createEventEnvelope({
        eventType: CREATIVE_EVENTS.EMPLOYEE_ONBOARDED,
        organizationId: "org-smoke-test",
        source: { type: "system", id: "platform" },
        payload: { employeeId: "creative", channels: ["linkedin", "twitter"] },
      });

      const result = await handleOnboarded(event, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe("content.calendar_updated");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Cartridge action execution
  // ---------------------------------------------------------------------------

  describe("cartridge execution", () => {
    it("executes creative.content.draft via cartridge", async () => {
      const result = await creative.cartridge.execute(
        "creative.content.draft",
        {
          channel: "linkedin",
          format: "post",
          content: "Great content about AI trends.",
          topic: "AI trends",
        },
        {} as never,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain("linkedin");
    });

    it("rejects invalid action params", async () => {
      const result = await creative.cartridge.execute(
        "creative.content.draft",
        { channel: "linkedin" }, // missing required fields
        {} as never,
      );

      expect(result.success).toBe(false);
    });

    it("returns failure for unknown action type", async () => {
      const result = await creative.cartridge.execute("creative.unknown.action", {}, {} as never);

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Unknown");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Event correlation through compiled handler
  // ---------------------------------------------------------------------------

  describe("event correlation", () => {
    it("compiled handler maps EmployeeHandlerResult to AgentResponse", async () => {
      // The compiled handler uses placeholder context, so content will be empty string
      // but the structural mapping (actions→actionType, events→envelopes) still works
      const sourceEvent = createEventEnvelope({
        eventType: CREATIVE_EVENTS.CONTENT_REQUESTED,
        organizationId: "org-smoke-test",
        source: { type: "manual", id: "user-1" },
        payload: { channel: "linkedin", format: "post", topic: "Test" },
      });

      const result = await creative.handler.handle(sourceEvent, {}, {
        organizationId: "org-smoke-test",
      } as never);

      // Compiled handler maps action.type → actionType
      expect(result.actions[0]!.actionType).toBe("creative.content.draft");

      // Output events carry correlation chain
      const outputEvent = result.events[0]!;
      expect(outputEvent.correlationId).toBe(sourceEvent.correlationId);
      expect(outputEvent.causationId).toBe(sourceEvent.eventId);
      expect(outputEvent.eventType).toBe(CREATIVE_EVENTS.CONTENT_DRAFT_READY);
    });
  });
});
