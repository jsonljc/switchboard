import { describe, it, expect, vi, afterEach } from "vitest";
import { NoopOperatorAlerter, WebhookOperatorAlerter, safeAlert } from "../operator-alerter.js";
import type { InfrastructureFailureAlert, OperatorAlerter } from "../operator-alerter.js";

const samplePayload: InfrastructureFailureAlert = {
  errorType: "governance_eval_exception",
  severity: "critical",
  errorMessage: "boom",
  retryable: false,
  occurredAt: "2026-04-28T00:00:00.000Z",
  source: "platform_ingress",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoopOperatorAlerter", () => {
  it("resolves without throwing and performs no I/O", async () => {
    const alerter = new NoopOperatorAlerter();
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
  });
});

describe("safeAlert", () => {
  it("swallows alerter throws and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: OperatorAlerter = {
      alert: vi.fn().mockRejectedValue(new Error("alerter down")),
    };
    await expect(safeAlert(failing, samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[OperatorAlerter] alert delivery failed",
      expect.any(Error),
    );
  });

  it("propagates nothing on alerter success", async () => {
    const ok: OperatorAlerter = { alert: vi.fn().mockResolvedValue(undefined) };
    await expect(safeAlert(ok, samplePayload)).resolves.toBeUndefined();
  });
});

describe("WebhookOperatorAlerter", () => {
  it("POSTs JSON payload to the configured URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const alerter = new WebhookOperatorAlerter({ webhookUrl: "https://example.test/alert" });
    await alerter.alert(samplePayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/alert");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(samplePayload);
  });

  it("swallows non-2xx responses and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));

    const alerter = new WebhookOperatorAlerter({ webhookUrl: "https://example.test/alert" });
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("swallows AbortError on timeout and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const alerter = new WebhookOperatorAlerter({
      webhookUrl: "https://example.test/alert",
      timeoutMs: 10,
    });
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("swallows fetch throws and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns fail")));

    const alerter = new WebhookOperatorAlerter({ webhookUrl: "https://example.test/alert" });
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("InfrastructureErrorType — work_trace_locked_violation variant", () => {
  it("accepts the new variant in alert payloads", async () => {
    const alerter = new NoopOperatorAlerter();
    const payload: InfrastructureFailureAlert = {
      errorType: "work_trace_locked_violation",
      severity: "warning",
      errorMessage: "Forbidden mutation rejected",
      retryable: false,
      occurredAt: new Date().toISOString(),
      source: "platform_ingress",
    };
    await expect(alerter.alert(payload)).resolves.toBeUndefined();
  });
});
