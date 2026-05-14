import type { FastifyPluginAsync } from "fastify";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
void GRAPH_BASE; // used in Task 6 handler

interface GraphErrorBody {
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
    error_subcode?: number;
  };
}

// Mirrors graphGet's return shape — NO `retryable` field. Callers infer retryable from code.
export type GraphPostResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; httpStatus: number };

// `url` is a full URL — matches graphGet's convention. Caller composes ${graphBase}/${phoneNumberId}/messages.
export async function graphPost(
  url: string,
  body: unknown,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GraphPostResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      code: "WHATSAPP_NETWORK_ERROR",
      message: err instanceof Error ? err.message : "network error",
      httpStatus: 502,
    };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = {};
  }
  if (res.ok) return { ok: true, data: parsed };

  const errBody = parsed as GraphErrorBody;
  const code = Number(errBody.error?.code ?? 0);
  const subcode = Number(errBody.error?.error_subcode ?? 0);
  const message = errBody.error?.message ?? "Graph API error";

  if (code === 190) return { ok: false, code: "WHATSAPP_TOKEN_INVALID", message, httpStatus: 502 };
  if (code === 200 || code === 10 || res.status === 403)
    return { ok: false, code: "WHATSAPP_GRAPH_PERMISSION_DENIED", message, httpStatus: 403 };
  if (res.status === 429 || code === 4 || subcode === 80007)
    return { ok: false, code: "WHATSAPP_RATE_LIMITED", message, httpStatus: 429 };
  if (code === 132000 || code === 132001)
    return { ok: false, code: "WHATSAPP_TEMPLATE_NOT_FOUND", message, httpStatus: 400 };
  return { ok: false, code: "WHATSAPP_UPSTREAM_ERROR", message, httpStatus: 502 };
}

// Boundary helper — derive the user-facing retryable flag for the JSON error envelope.
// Intentionally LOCAL to whatsapp-send-test.ts for now. whatsapp-management.ts:398 has its
// own narrower inline check (`code === "WHATSAPP_RATE_LIMITED"`). Unifying both into a
// shared util is a separate follow-up; do not move this helper unless you also update
// whatsapp-management.ts' inline check and add a regression test for /templates' retryable flag.
export function isRetryable(code: string): boolean {
  return (
    code === "WHATSAPP_RATE_LIMITED" ||
    code === "WHATSAPP_UPSTREAM_ERROR" ||
    code === "WHATSAPP_NETWORK_ERROR" ||
    code === "WHATSAPP_NO_MESSAGE_ID"
  );
}

export interface SendTestOptions {
  graphApiFetch?: typeof fetch;
}

export const whatsappSendTestRoutes: FastifyPluginAsync<SendTestOptions> = async (app, opts) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;
  void fetchImpl; // used in Task 6 handler

  app.post("/send-test", async (_req, reply) =>
    reply
      .code(501)
      .send({ error: { code: "NOT_IMPLEMENTED", message: "filled next task", retryable: false } }),
  );
  app.get("/test-sends", async (_req, reply) =>
    reply
      .code(501)
      .send({ error: { code: "NOT_IMPLEMENTED", message: "filled next task", retryable: false } }),
  );
};
