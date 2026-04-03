import type { AgentContext, RoutedEventEnvelope } from "@switchboard/schemas";
import { createEventEnvelope } from "@switchboard/schemas";
import type {
  AgentHandler,
  AgentResponse,
  EmployeeConfig,
  EmployeeContext,
  EmployeeHandlerResult,
} from "./types.js";

export function compileHandler(
  config: EmployeeConfig,
  contextFactory: (agentContext: AgentContext, event: RoutedEventEnvelope) => EmployeeContext,
): AgentHandler {
  return {
    async handle(
      event: RoutedEventEnvelope,
      _config: Record<string, unknown>,
      agentContext: AgentContext,
    ): Promise<AgentResponse> {
      const employeeCtx = contextFactory(agentContext, event);
      const result = await config.handle(event, employeeCtx);
      return mapResult(result, event, config.id);
    },
  };
}

function mapResult(
  result: EmployeeHandlerResult,
  sourceEvent: RoutedEventEnvelope,
  employeeId: string,
): AgentResponse {
  return {
    events: result.events.map((e) =>
      createEventEnvelope({
        eventType: e.type,
        organizationId: sourceEvent.organizationId,
        source: { type: "agent", id: employeeId },
        payload: e.payload,
        correlationId: sourceEvent.correlationId,
        causationId: sourceEvent.eventId,
      }),
    ),
    actions: result.actions.map((a) => ({
      actionType: a.type,
      parameters: a.params,
    })),
  };
}
