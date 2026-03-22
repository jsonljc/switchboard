/** Normalized gateway failure modes for worker retry vs failSession mapping */

export class GatewayTimeoutError extends Error {
  constructor(message = "Gateway request timed out", cause?: unknown) {
    super(message);
    this.name = "GatewayTimeoutError";
    this.cause = cause;
  }
}

export class GatewayTransportError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = "GatewayTransportError";
    this.cause = cause;
  }
}

export class GatewayInvalidResponseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GatewayInvalidResponseError";
  }
}

export class GatewayRejectedAuthError extends Error {
  constructor(
    message = "Gateway rejected session credentials",
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "GatewayRejectedAuthError";
  }
}

/** User/API cancelled the session — in-flight invoke/resume fetch was aborted locally */
export class GatewayInvocationAbortedError extends Error {
  constructor(message = "Gateway invocation aborted (session cancelled)") {
    super(message);
    this.name = "GatewayInvocationAbortedError";
  }
}

/** Circuit breaker is open — fail fast without waiting on network timeouts */
export class GatewayCircuitOpenError extends Error {
  constructor(message = "OpenClaw gateway circuit breaker is open") {
    super(message);
    this.name = "GatewayCircuitOpenError";
  }
}

/** HTTP success but gateway returned structured terminal failure (do not retry transport) */
export class GatewayTerminalFailureError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "GatewayTerminalFailureError";
  }
}
