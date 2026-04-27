import { describe, it, expect, vi } from "vitest";
import { notifyChatProvisionedChannel } from "../notify-chat-provisioned-channel.js";

describe("notifyChatProvisionedChannel", () => {
  const okFetch = (() =>
    Promise.resolve(new Response("{}", { status: 200 }))) as unknown as typeof fetch;

  it("returns config_error when chatPublicUrl is missing", async () => {
    const fetchImpl = vi.fn(okFetch);
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: undefined,
      internalApiSecret: "secret",
      fetchImpl,
    });
    expect(result.kind).toBe("config_error");
    if (result.kind === "config_error") {
      expect(result.reason).toMatch(/CHAT_PUBLIC_URL/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns config_error when internalApiSecret is missing", async () => {
    const fetchImpl = vi.fn(okFetch);
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: undefined,
      fetchImpl,
    });
    expect(result.kind).toBe("config_error");
    if (result.kind === "config_error") {
      expect(result.reason).toMatch(/INTERNAL_API_SECRET/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns config_error mentioning both when both env vars are missing", async () => {
    const fetchImpl = vi.fn(okFetch);
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: "",
      internalApiSecret: "",
      fetchImpl,
    });
    expect(result.kind).toBe("config_error");
    if (result.kind === "config_error") {
      expect(result.reason).toMatch(/CHAT_PUBLIC_URL/);
      expect(result.reason).toMatch(/INTERNAL_API_SECRET/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns ok on successful first attempt; fetch called once", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "secret",
      fetchImpl,
    });
    expect(result.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on non-2xx and returns ok if retry succeeds; fetch called twice", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) return new Response("nope", { status: 503 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "secret",
      fetchImpl,
    });
    expect(result.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns fail with last error when both attempts fail", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("err", { status: 500 }),
    ) as unknown as typeof fetch;
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "secret",
      fetchImpl,
    });
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.reason).toMatch(/500/);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries when fetch throws and returns ok if retry succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("network kaboom");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_1",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "secret",
      fetchImpl,
    });
    expect(result.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends Authorization Bearer header and managedChannelId body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: typeof url === "string" ? url : url.toString(), init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await notifyChatProvisionedChannel({
      managedChannelId: "mc_xyz",
      chatPublicUrl: "https://chat.example.com",
      internalApiSecret: "topsecret",
      fetchImpl,
    });
    expect(result.kind).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://chat.example.com/internal/provision-notify");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer topsecret");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toEqual({ managedChannelId: "mc_xyz" });
  });
});
