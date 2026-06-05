import type {
  ApprovalRespondTransport,
  ChannelApprovalRespondRequest,
  ChannelApprovalRespondOutcome,
  ChannelApprovalRefusalCode,
} from "./respond-to-channel-approval.js";

// HTTP half of the chat approval bridge (spec
// docs/superpowers/specs/2026-06-05-chat-approval-bridge-design.md section 3.2).
// Forwards the webhook-authenticated channel identity to the API internal
// route; the API re-derives the operator principal server-side. One retry on
// transient transport failures: a duplicate respond is safe (the engine's
// optimistic locks surface it as already_responded, never a second dispatch).
// Lives in core beside the seam it implements so the apps/api e2e proof can
// drive the REAL production class; apps/chat consumes it from the barrel.

export interface HttpApprovalRespondTransportOptions {
  baseUrl: string;
  internalApiSecret: string;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout; ONE retry on network error/timeout/502/503/504. */
  timeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const REFUSAL_CODES: ReadonlySet<string> = new Set([
  "not_found",
  "stale",
  "not_authorized",
  "lookup_error",
  "already_responded",
  "conflict",
  "expired",
  "self_approval",
  "admission_failed",
  "execution_error",
] satisfies ChannelApprovalRefusalCode[]);

export class BridgeTransportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, opts?: { retryable?: boolean }) {
    super(message);
    this.name = "BridgeTransportError";
    this.retryable = opts?.retryable ?? false;
  }
}

/** Strict runtime guard: an unknown shape or code maps to a lookup-error
 * reply on the gateway side instead of an undefined reply string. */
function isRespondOutcome(value: unknown): value is ChannelApprovalRespondOutcome {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj["kind"] === "responded") {
    return (
      (obj["action"] === "approve" || obj["action"] === "reject") &&
      (typeof obj["executionSuccess"] === "boolean" || obj["executionSuccess"] === null)
    );
  }
  if (obj["kind"] === "refused") {
    return typeof obj["code"] === "string" && REFUSAL_CODES.has(obj["code"]);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpApprovalRespondTransport implements ApprovalRespondTransport {
  constructor(private readonly options: HttpApprovalRespondTransportOptions) {}

  async respond(request: ChannelApprovalRespondRequest): Promise<ChannelApprovalRespondOutcome> {
    if (!this.options.baseUrl || !this.options.internalApiSecret) {
      // Fail closed: never forward without the trust channel. The gateway
      // renders this as a lookup error; it must never silently approve.
      throw new BridgeTransportError("approval respond bridge is not configured");
    }
    let lastError: BridgeTransportError | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) {
        await sleep(this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
      }
      try {
        return await this.attempt(request);
      } catch (err) {
        if (err instanceof BridgeTransportError && err.retryable) {
          console.error(`[approval-bridge] attempt ${attempt} failed (retryable): ${err.message}`);
          lastError = err;
          continue;
        }
        console.error(
          `[approval-bridge] attempt ${attempt} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    }
    throw lastError ?? new BridgeTransportError("approval respond bridge failed");
  }

  private async attempt(
    request: ChannelApprovalRespondRequest,
  ): Promise<ChannelApprovalRespondOutcome> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetchImpl(`${this.options.baseUrl}/api/internal/chat-approvals/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.internalApiSecret}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new BridgeTransportError(
        `network error: ${err instanceof Error ? err.message : String(err)}`,
        { retryable: true },
      );
    }
    if (!response.ok) {
      throw new BridgeTransportError(`bridge HTTP ${response.status}`, {
        retryable: RETRYABLE_STATUS.has(response.status),
      });
    }
    let outcome: unknown;
    try {
      outcome = await response.json();
    } catch {
      throw new BridgeTransportError("bridge returned a non-JSON body");
    }
    if (!isRespondOutcome(outcome)) {
      throw new BridgeTransportError("bridge returned a malformed outcome");
    }
    return outcome;
  }
}
