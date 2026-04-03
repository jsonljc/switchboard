import { defineEmployee } from "@switchboard/employee-sdk";
import type { RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeHandlerResult } from "@switchboard/employee-sdk";
import { CREATIVE_EVENTS } from "@switchboard/schemas";
import {
  ContentDraftParamsSchema,
  ContentReviseParamsSchema,
  ContentPublishParamsSchema,
  CalendarPlanParamsSchema,
  CalendarScheduleParamsSchema,
  CompetitorAnalyzeParamsSchema,
  PerformanceReportParamsSchema,
} from "./schemas.js";

// Handlers
import { handleContentRequested } from "./handlers/content-requested.js";
import { handleContentRejected } from "./handlers/content-rejected.js";
import { handleContentApproved } from "./handlers/content-approved.js";
import { handlePerformanceUpdated } from "./handlers/performance-updated.js";
import { handleOnboarded } from "./handlers/onboarded.js";

// Executors
import { executeDraft } from "./execute/draft.js";
import { executeRevise } from "./execute/revise.js";
import { executePublish } from "./execute/publish.js";
import { executeCalendarPlan, executeCalendarSchedule } from "./execute/calendar.js";
import { executeAnalyze } from "./execute/analyze.js";
import { executeReport } from "./execute/report.js";

const creative = defineEmployee({
  id: "creative",
  name: "AI Creative",
  version: "1.0.0",
  description:
    "Content strategist and creator that learns your brand voice, generates content across channels, and improves from feedback.",

  personality: {
    role: "You are a professional content strategist and creator. You produce high-quality content that matches the brand voice, engages the target audience, and drives business outcomes.",
    tone: "professional yet creative",
    traits: ["brand-aware", "data-driven", "adaptive", "concise", "audience-focused"],
  },

  inboundEvents: [
    CREATIVE_EVENTS.CONTENT_REQUESTED,
    CREATIVE_EVENTS.CONTENT_APPROVED,
    CREATIVE_EVENTS.CONTENT_REJECTED,
    CREATIVE_EVENTS.CONTENT_PERFORMANCE_UPDATED,
    CREATIVE_EVENTS.EMPLOYEE_ONBOARDED,
  ],

  outboundEvents: [
    CREATIVE_EVENTS.CONTENT_DRAFT_READY,
    CREATIVE_EVENTS.CONTENT_PUBLISHED,
    CREATIVE_EVENTS.CONTENT_CALENDAR_UPDATED,
  ],

  actions: [
    {
      type: "creative.content.draft",
      description: "Create a content draft for a specific channel and format",
      riskCategory: "low",
      reversible: true,
      parameters: ContentDraftParamsSchema,
    },
    {
      type: "creative.content.revise",
      description: "Revise a rejected content draft based on feedback",
      riskCategory: "low",
      reversible: true,
      parameters: ContentReviseParamsSchema,
    },
    {
      type: "creative.content.publish",
      description: "Publish an approved content draft to the target channel",
      riskCategory: "medium",
      reversible: false,
      parameters: ContentPublishParamsSchema,
    },
    {
      type: "creative.calendar.plan",
      description: "Create a content calendar plan for a date range",
      riskCategory: "low",
      reversible: true,
      parameters: CalendarPlanParamsSchema,
    },
    {
      type: "creative.calendar.schedule",
      description: "Schedule a specific content piece for publication",
      riskCategory: "low",
      reversible: true,
      parameters: CalendarScheduleParamsSchema,
    },
    {
      type: "creative.competitor.analyze",
      description: "Analyze competitor content strategy",
      riskCategory: "low",
      reversible: false,
      parameters: CompetitorAnalyzeParamsSchema,
    },
    {
      type: "creative.performance.report",
      description: "Generate a content performance report",
      riskCategory: "low",
      reversible: false,
      parameters: PerformanceReportParamsSchema,
    },
  ],

  connections: [{ service: "openai", purpose: "Content generation and analysis", required: false }],

  policies: [
    { action: "creative.content.draft", effect: "allow" },
    { action: "creative.content.revise", effect: "allow" },
    { action: "creative.content.publish", effect: "require_approval" },
    { action: "creative.calendar.plan", effect: "allow" },
    { action: "creative.calendar.schedule", effect: "allow" },
    { action: "creative.competitor.analyze", effect: "allow" },
    { action: "creative.performance.report", effect: "allow" },
  ],

  guardrails: {
    rateLimits: [
      { actionPattern: "creative.content.draft", maxPerHour: 20 },
      { actionPattern: "creative.content.publish", maxPerHour: 10 },
    ],
    cooldowns: [{ actionPattern: "creative.content.publish", seconds: 60 }],
  },

  async handle(
    event: RoutedEventEnvelope,
    context: EmployeeContext,
  ): Promise<EmployeeHandlerResult> {
    switch (event.eventType) {
      case CREATIVE_EVENTS.CONTENT_REQUESTED:
        return handleContentRequested(event, context);
      case CREATIVE_EVENTS.CONTENT_REJECTED:
        return handleContentRejected(event, context);
      case CREATIVE_EVENTS.CONTENT_APPROVED:
        return handleContentApproved(event, context);
      case CREATIVE_EVENTS.CONTENT_PERFORMANCE_UPDATED:
        return handlePerformanceUpdated(event, context);
      case CREATIVE_EVENTS.EMPLOYEE_ONBOARDED:
        return handleOnboarded(event, context);
      default:
        return { actions: [], events: [] };
    }
  },

  async execute(actionType, params, context) {
    switch (actionType) {
      case "creative.content.draft":
        return executeDraft(params, context);
      case "creative.content.revise":
        return executeRevise(params, context);
      case "creative.content.publish":
        return executePublish(params, context);
      case "creative.calendar.plan":
        return executeCalendarPlan(params, context);
      case "creative.calendar.schedule":
        return executeCalendarSchedule(params, context);
      case "creative.competitor.analyze":
        return executeAnalyze(params, context);
      case "creative.performance.report":
        return executeReport(params, context);
      default:
        return {
          success: false,
          summary: `Unknown action type: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: null,
        };
    }
  },
});

export default creative;
