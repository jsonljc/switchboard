/**
 * Shared HTTP client for MCP → Switchboard API communication.
 * Follows the same patterns as apps/chat/src/api-orchestrator-adapter.ts.
 */
import { randomUUID } from "node:crypto";

export interface McpApiClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export class McpApiClient {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor(config: McpApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  /** Generate a new idempotency key. */
  idempotencyKey(prefix = "mcp"): string {
    return `${prefix}_${randomUUID()}`;
  }

  /**
   * Fetch with retry (retries 5xx and 429, not 4xx).
   * Up to 3 attempts with exponential backoff.
   */
  async fetch(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.headers(init.idempotencyKey);

    // Merge headers
    if (init.headers) {
      const extra = init.headers as Record<string, string>;
      Object.assign(headers, extra);
    }

    const fetchInit: RequestInit = {
      ...init,
      headers,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, fetchInit);
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`HTTP ${res.status}`);
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  /** Convenience: POST JSON and return parsed response. */
  async post<T = unknown>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<{ status: number; data: T }> {
    const res = await this.fetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey,
    });
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }

  /** Convenience: GET and return parsed response. */
  async get<T = unknown>(path: string): Promise<{ status: number; data: T }> {
    const res = await this.fetch(path, { method: "GET" });
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }

  /** Convenience: PUT JSON and return parsed response. */
  async put<T = unknown>(path: string, body: unknown): Promise<{ status: number; data: T }> {
    const res = await this.fetch(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }
}
