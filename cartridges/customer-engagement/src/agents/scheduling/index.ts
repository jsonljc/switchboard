// ---------------------------------------------------------------------------
// Scheduling Agent — Booking, rescheduling, reminders
// ---------------------------------------------------------------------------

import type { AgentModule } from "../types.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { JourneyStageId } from "../../core/types.js";
import type { CalendarProvider, SMSProvider } from "../../cartridge/providers/provider.js";
import { executeBookAppointment } from "../../cartridge/actions/book-appointment.js";
import { executeCancelAppointment } from "../../cartridge/actions/cancel-appointment.js";
import { executeRescheduleAppointment } from "../../cartridge/actions/reschedule-appointment.js";
import { executeSendReminder } from "../../cartridge/actions/send-reminder.js";

export class SchedulingAgent implements AgentModule {
  readonly type = "scheduling" as const;
  readonly stages: JourneyStageId[] = ["consultation_booked", "service_scheduled"];

  constructor(
    private readonly calendar: CalendarProvider,
    private readonly sms: SMSProvider,
    private readonly calendarId: string,
    private readonly fromNumber: string,
  ) {}

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    switch (actionType) {
      case "customer-engagement.appointment.book":
        return executeBookAppointment(parameters, this.calendar, this.calendarId);
      case "customer-engagement.appointment.cancel":
        return executeCancelAppointment(parameters, this.calendar, this.calendarId);
      case "customer-engagement.appointment.reschedule":
        return executeRescheduleAppointment(parameters, this.calendar, this.calendarId);
      case "customer-engagement.reminder.send":
        return executeSendReminder(parameters, this.sms, this.fromNumber);
      default:
        return {
          success: false,
          summary: `SchedulingAgent cannot handle action: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "route", error: `Unknown action: ${actionType}` }],
          durationMs: 0,
          undoRecipe: null,
        };
    }
  }
}
