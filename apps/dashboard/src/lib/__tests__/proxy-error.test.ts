import { describe, it, expect } from "vitest";
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
});
