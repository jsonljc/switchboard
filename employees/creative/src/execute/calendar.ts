import type { ExecuteResult } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";
import { CalendarPlanParamsSchema, CalendarScheduleParamsSchema } from "../schemas.js";

export async function executeCalendarPlan(
  params: Record<string, unknown>,
  _context: EmployeeContext,
): Promise<ExecuteResult> {
  const parsed = CalendarPlanParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      summary: `Invalid calendar plan params: ${parsed.error.message}`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    };
  }

  return {
    success: true,
    summary: `Content calendar planned for ${parsed.data.channels.join(", ")}`,
    externalRefs: {},
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
    data: parsed.data,
  };
}

export async function executeCalendarSchedule(
  params: Record<string, unknown>,
  _context: EmployeeContext,
): Promise<ExecuteResult> {
  const parsed = CalendarScheduleParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      summary: `Invalid schedule params: ${parsed.error.message}`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    };
  }

  return {
    success: true,
    summary: `Scheduled ${parsed.data.topic} for ${parsed.data.channel} on ${parsed.data.scheduledFor}`,
    externalRefs: {},
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
    data: parsed.data,
  };
}
