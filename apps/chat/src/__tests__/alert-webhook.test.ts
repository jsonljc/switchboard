import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("sendHealthCheckAlert", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    delete process.env["ALERT_WEBHOOK_URL"];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is a no-op when ALERT_WEBHOOK_URL is unset", async () => {
    const { sendHealthCheckAlert } = await import("../managed/alert-webhook.js");
    await sendHealthCheckAlert("failure", { channel: "telegram", channelId: "ch-1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs Slack-shaped failure body when configured", async () => {
    process.env["ALERT_WEBHOOK_URL"] = "https://hooks.example/test";
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const { sendHealthCheckAlert } = await import("../managed/alert-webhook.js");
    await sendHealthCheckAlert("failure", {
      channel: "telegram",
      channelId: "ch-1",
      statusDetail: "Bot token revoked",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.example/test");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("🚨 Chat health check failed: telegram/ch-1 — Bot token revoked");
  });

  it("POSTs Slack-shaped recovery body when configured", async () => {
    process.env["ALERT_WEBHOOK_URL"] = "https://hooks.example/test";
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const { sendHealthCheckAlert } = await import("../managed/alert-webhook.js");
    await sendHealthCheckAlert("recovery", { channel: "whatsapp", channelId: "ch-2" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.text).toBe("✅ Chat health recovered: whatsapp/ch-2");
  });

  it("uses 'unknown' when statusDetail is missing for failure", async () => {
    process.env["ALERT_WEBHOOK_URL"] = "https://hooks.example/test";
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const { sendHealthCheckAlert } = await import("../managed/alert-webhook.js");
    await sendHealthCheckAlert("failure", { channel: "slack", channelId: "ch-3" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.text).toBe("🚨 Chat health check failed: slack/ch-3 — unknown");
  });

  it("swallows fetch rejection and logs to console.error", async () => {
    process.env["ALERT_WEBHOOK_URL"] = "https://hooks.example/test";
    fetchMock.mockRejectedValue(new Error("network down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendHealthCheckAlert } = await import("../managed/alert-webhook.js");
    await expect(
      sendHealthCheckAlert("failure", { channel: "telegram", channelId: "ch-1" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith("[alert-webhook] error:", expect.any(Error));
  });

  it("logs non-2xx response without throwing", async () => {
    process.env["ALERT_WEBHOOK_URL"] = "https://hooks.example/test";
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendHealthCheckAlert } = await import("../managed/alert-webhook.js");
    await expect(
      sendHealthCheckAlert("failure", { channel: "telegram", channelId: "ch-1" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith("[alert-webhook] failed:", 500, "Internal Server Error");
  });
});
