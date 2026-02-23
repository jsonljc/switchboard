import type { RuntimeAdapter } from "./types.js";
import type { RuntimeExecuteRequest, RuntimeExecuteResponse } from "./types.js";

/**
 * Options for HTTP-based execution (e.g. OpenClaw skill calling Switchboard API).
 */
export interface HttpExecutionAdapterOptions {
  /** Base URL of the Switchboard API (e.g. https://api.switchboard.example.com). */
  baseUrl: string;
  /** Optional Bearer token for Authorization header. */
  apiKey?: string;
  /** Optional Idempotency-Key per request; if not set, a UUID is used. */
  idempotencyKey?: string;
}

/**
 * RuntimeAdapter that calls POST /api/execute over HTTP.
 * Use this when the OpenClaw plugin runs in a different process from Switchboard.
 */
export class HttpExecutionAdapter implements RuntimeAdapter {
  constructor(private options: HttpExecutionAdapterOptions) {}

  async execute(request: RuntimeExecuteRequest): Promise<RuntimeExecuteResponse> {
    const base = this.options.baseUrl.replace(/\/$/, "");
    const url = `${base}/api/execute`;
    const idempotencyKey = this.options.idempotencyKey ?? `exec_${crypto.randomUUID()}`;

    const body = {
      actorId: request.actorId,
      organizationId: request.organizationId ?? undefined,
      action: request.requestedAction,
      entityRefs: request.entityRefs,
      message: request.message,
      traceId: request.traceId,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let message = `Switchboard API error ${res.status}: ${res.statusText}`;
      try {
        const json = JSON.parse(errBody) as { error?: string; question?: string; explanation?: string };
        message = json.error ?? json.question ?? json.explanation ?? message;
      } catch {
        if (errBody) message += ` — ${errBody.slice(0, 200)}`;
      }
      throw new Error(message);
    }

    const data = (await res.json()) as RuntimeExecuteResponse;
    return data;
  }
}
