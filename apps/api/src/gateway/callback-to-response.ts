import type { GatewayInvokeResponse, SessionRunCallbackBody } from "@switchboard/schemas";

export function sessionCallbackBodyToGatewayResponse(
  body: SessionRunCallbackBody,
): GatewayInvokeResponse {
  switch (body.status) {
    case "completed":
      return {
        status: "completed",
        toolCalls: body.toolCalls,
        result: body.result,
      };
    case "paused":
      return {
        status: "paused",
        checkpoint: body.checkpoint,
        toolCalls: body.toolCalls,
      };
    case "failed":
      return {
        status: "failed",
        error: body.error,
        toolCalls: body.toolCalls,
      };
    default: {
      const _x: never = body;
      return _x;
    }
  }
}
