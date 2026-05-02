import { describe, it, expect, vi } from "vitest";
import { proxyError } from "../proxy-error";

describe("proxyError", () => {
  it("uses error and statusCode from backend body", async () => {
    const res = proxyError({ error: "Not found", statusCode: 404 }, 500);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found", statusCode: 404 });
  });

  it("uses error from backend body and fallbackStatus when statusCode is missing", async () => {
    const res = proxyError({ error: "Bad input" }, 500);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Bad input", statusCode: 500 });
  });

  it("falls back to 'Request failed' and fallbackStatus when backend body is empty object", async () => {
    const res = proxyError({}, 500);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Request failed", statusCode: 500 });
  });

  it("falls back to 'Request failed' and fallbackStatus when backend body is null", async () => {
    const res = proxyError(null, 503);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Request failed", statusCode: 503 });
  });

  it("falls back to 'Request failed' and fallbackStatus when backend body is a string", async () => {
    const res = proxyError("some error string", 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Request failed", statusCode: 400 });
  });

  it("writes the full upstream body to console.error for 5xx responses", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    proxyError(
      { error: "OrganizationConfig.upsert failed", statusCode: 500, stack: "Error: …\n  at …" },
      500,
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[proxyError]",
      expect.objectContaining({
        statusCode: 500,
        body: expect.objectContaining({
          error: "OrganizationConfig.upsert failed",
          stack: expect.any(String),
        }),
      }),
    );
    errorSpy.mockRestore();
  });

  it("does not log to console.error for 4xx responses", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    proxyError({ error: "Bad input" }, 400);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("regression: forwards a C2a-shaped dev-mode upstream error verbatim", async () => {
    // C2a (apps/api/src/bootstrap/error-handler.ts) sends this exact shape
    // for 5xx in NODE_ENV=development. Lock the contract: proxyError must
    // pass the `error` field through unchanged so the dashboard banner reads it.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = proxyError(
      { error: "OrganizationConfig.upsert failed", statusCode: 500, stack: "Error: …" },
      500,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "OrganizationConfig.upsert failed", statusCode: 500 });
    errorSpy.mockRestore();
  });
});
