// ---------------------------------------------------------------------------
// Creative Testing handlers — test queue, evaluation, power, create, conclude
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { VariantMetrics } from "../../creative/testing-queue.js";

export const creativeTestingHandlers: Map<string, ActionHandler> = new Map([
  // ---- READ handlers ----

  [
    "digital-ads.creative.test_queue",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const statusFilter = params.status as string | undefined;
        const tests = ctx.creativeTestingQueue.listTests(
          statusFilter
            ? { status: statusFilter as "queued" | "running" | "concluded" | "cancelled" }
            : undefined,
        );
        const calendar = ctx.creativeTestingQueue.getCalendar((params.weeks as number) ?? 8);
        return success(
          `Creative test queue: ${tests.length} test(s), ${calendar.filter((e) => e.status === "available").length} available slot(s)`,
          { tests, calendar },
          start,
        );
      } catch (err) {
        return fail(`Failed to get test queue: ${errMsg(err)}`, "creative.test_queue", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.creative.test_evaluate",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const testId = params.testId as string;
        if (!testId) return fail("Missing testId", "validation", "testId is required");
        const variantMetrics = (params.variantMetrics ?? []) as VariantMetrics[];
        if (variantMetrics.length < 2) {
          return fail(
            "At least 2 variant metrics are required for evaluation",
            "validation",
            "Provide variantMetrics array with at least 2 variants",
          );
        }
        const result = ctx.creativeTestingQueue.evaluateTest(testId, variantMetrics);
        return success(
          result.statisticalSignificance
            ? `Test ${testId} has a winner: ${result.winnerVariantId} (p=${result.pValue.toFixed(4)})`
            : `Test ${testId}: no significant winner yet (p=${result.pValue.toFixed(4)})`,
          result,
          start,
          { externalRefs: { testId } },
        );
      } catch (err) {
        return fail(
          `Failed to evaluate test: ${errMsg(err)}`,
          "creative.test_evaluate",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.creative.power_calculate",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const baselineRate = params.baselineRate as number;
        const minimumDetectableEffect = params.minimumDetectableEffect as number;
        if (baselineRate === undefined || minimumDetectableEffect === undefined) {
          return fail(
            "Missing baselineRate or minimumDetectableEffect",
            "validation",
            "baselineRate and minimumDetectableEffect are required",
          );
        }
        const result = ctx.creativeTestingQueue.calculatePower({
          baselineRate,
          minimumDetectableEffect,
          significanceLevel: params.significanceLevel as number | undefined,
          power: params.power as number | undefined,
          numVariants: params.numVariants as number | undefined,
          estimatedDailyTraffic: params.estimatedDailyTraffic as number | undefined,
          estimatedCPM: params.estimatedCPM as number | undefined,
        });
        return success(
          `Power calculation: need ${result.requiredSamplesPerVariant.toLocaleString()} samples/variant, ~${result.estimatedDaysToReach} days, ~$${result.totalEstimatedBudget.toFixed(2)} total budget`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to calculate power: ${errMsg(err)}`,
          "creative.power_calculate",
          errMsg(err),
        );
      }
    },
  ],

  // ---- WRITE handlers ----

  [
    "digital-ads.creative.test_create",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const name = params.name as string;
        const hypothesis = params.hypothesis as string;
        const variants = params.variants as Array<{
          variantId: string;
          description: string;
          adId?: string;
        }>;
        const primaryMetric = (params.primaryMetric ?? "cpa") as
          | "cpa"
          | "ctr"
          | "conversion_rate"
          | "roas";
        const minBudgetPerVariant = (params.minBudgetPerVariant as number) ?? 0;
        const scheduledStartDate = (params.scheduledStartDate as string) ?? null;

        if (!name || !hypothesis || !variants || variants.length < 2) {
          return fail(
            "Missing required test parameters",
            "validation",
            "name, hypothesis, and at least 2 variants are required",
          );
        }

        const test = ctx.creativeTestingQueue.queueTest({
          name,
          hypothesis,
          variants,
          primaryMetric,
          scheduledStartDate,
          minBudgetPerVariant,
        });

        return success(
          `Queued creative test "${name}" (${test.id}) with ${variants.length} variants, primary metric: ${primaryMetric}`,
          test,
          start,
          {
            externalRefs: { testId: test.id },
            rollbackAvailable: true,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.creative.test_conclude",
              reverseParameters: { testId: test.id },
              undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              undoRiskCategory: "low",
              undoApprovalRequired: "none",
            },
          },
        );
      } catch (err) {
        return fail(`Failed to create test: ${errMsg(err)}`, "creative.test_create", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.creative.test_conclude",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const testId = params.testId as string;
        if (!testId) return fail("Missing testId", "validation", "testId is required");

        const test = ctx.creativeTestingQueue.concludeTest(testId);
        const winnerSummary = test.winnerId
          ? ` — winner: ${test.winnerId}`
          : " — no winner declared";

        return success(
          `Concluded creative test "${test.name}" (${test.id})${winnerSummary}`,
          test,
          start,
          { externalRefs: { testId: test.id, winnerId: test.winnerId ?? "" } },
        );
      } catch (err) {
        return fail(
          `Failed to conclude test: ${errMsg(err)}`,
          "creative.test_conclude",
          errMsg(err),
        );
      }
    },
  ],
]);
