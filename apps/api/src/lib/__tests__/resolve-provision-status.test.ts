import { describe, it, expect } from "vitest";
import {
  resolveProvisionStatus,
  type StepResult,
  type ResolveInput,
} from "../resolve-provision-status.js";

const ok: StepResult = { kind: "ok", reason: null };
const fail = (reason: string): StepResult => ({ kind: "fail", reason });

function input(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return {
    metaConfig: ok,
    chatConfig: ok,
    metaRegister: ok,
    healthProbe: ok,
    chatNotify: ok,
    channel: "whatsapp",
    ...overrides,
  };
}

describe("resolveProvisionStatus", () => {
  it("returns active when every step is ok", () => {
    expect(resolveProvisionStatus(input())).toEqual({
      status: "active",
      statusDetail: null,
    });
  });

  it("returns config_error when only meta-config failed (names meta config)", () => {
    const res = resolveProvisionStatus(
      input({ metaConfig: fail("config_error_meta: missing WHATSAPP_GRAPH_TOKEN") }),
    );
    expect(res.status).toBe("config_error");
    expect(res.statusDetail).toMatch(/config_error_meta/);
  });

  it("returns config_error when only chat-config failed (names chat config)", () => {
    const res = resolveProvisionStatus(
      input({ chatConfig: fail("config_error_chat: missing CHAT_PUBLIC_URL") }),
    );
    expect(res.status).toBe("config_error");
    expect(res.statusDetail).toMatch(/config_error_chat/);
  });

  it("returns config_error and names BOTH when meta-config and chat-config both failed", () => {
    const res = resolveProvisionStatus(
      input({
        metaConfig: fail("config_error_meta: missing WHATSAPP_GRAPH_TOKEN"),
        chatConfig: fail("config_error_chat: missing CHAT_PUBLIC_URL"),
      }),
    );
    expect(res.status).toBe("config_error");
    expect(res.statusDetail).toMatch(/config_error_meta/);
    expect(res.statusDetail).toMatch(/config_error_chat/);
  });

  it("returns pending_chat_register when only notify failed", () => {
    const res = resolveProvisionStatus(
      input({ chatNotify: fail("Provision-notify failed after retry: HTTP 500") }),
    );
    expect(res.status).toBe("pending_chat_register");
    expect(res.statusDetail).toMatch(/Provision-notify/);
  });

  it("returns health_check_failed when only health failed", () => {
    const res = resolveProvisionStatus(input({ healthProbe: fail("Health probe failed: 401") }));
    expect(res.status).toBe("health_check_failed");
    expect(res.statusDetail).toMatch(/Health probe/);
  });

  it("returns pending_meta_register when only meta-register failed", () => {
    const res = resolveProvisionStatus(
      input({ metaRegister: fail("Meta /subscribed_apps failed: bad token") }),
    );
    expect(res.status).toBe("pending_meta_register");
    expect(res.statusDetail).toMatch(/subscribed_apps/);
  });

  it("notify failure wins over health failure", () => {
    const res = resolveProvisionStatus(
      input({
        chatNotify: fail("Provision-notify failed after retry: HTTP 500"),
        healthProbe: fail("Health probe failed: 401"),
      }),
    );
    expect(res.status).toBe("pending_chat_register");
  });

  it("health failure wins over meta-register failure", () => {
    const res = resolveProvisionStatus(
      input({
        healthProbe: fail("Health probe failed: 401"),
        metaRegister: fail("Meta /subscribed_apps failed: bad token"),
      }),
    );
    expect(res.status).toBe("health_check_failed");
  });

  it("meta-config failure wins over notify failure", () => {
    const res = resolveProvisionStatus(
      input({
        metaConfig: fail("config_error_meta: missing WHATSAPP_GRAPH_TOKEN"),
        chatNotify: fail("Provision-notify failed after retry: HTTP 500"),
      }),
    );
    expect(res.status).toBe("config_error");
  });

  it("returns config_error when all four step categories failed", () => {
    const res = resolveProvisionStatus(
      input({
        metaConfig: fail("config_error_meta: missing"),
        chatConfig: fail("config_error_chat: missing"),
        metaRegister: fail("Meta failed"),
        healthProbe: fail("Health failed"),
        chatNotify: fail("Notify failed"),
      }),
    );
    expect(res.status).toBe("config_error");
  });

  it("treats non-whatsapp channels as ok by default for meta/health steps", () => {
    const res = resolveProvisionStatus({
      metaConfig: ok,
      chatConfig: ok,
      metaRegister: ok,
      healthProbe: ok,
      chatNotify: ok,
      channel: "telegram",
    });
    expect(res.status).toBe("active");
    expect(res.statusDetail).toBeNull();
  });
});
