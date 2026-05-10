// apps/dashboard/src/lib/agent-home/__tests__/resolve-link.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentHomeLink } from "../resolve-link";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAgentHomeLink", () => {
  it("contact links resolve to /contacts/[id] when NEXT_PUBLIC_CONTACTS_LIVE='true'", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
    const r = resolveAgentHomeLink({ kind: "contact", id: "c1" });
    expect(r.disabled).toBe(false);
    if (!r.disabled) {
      expect(r.href).toBe("/contacts/c1");
    }
  });

  it("contact links resolve disabled when NEXT_PUBLIC_CONTACTS_LIVE is unset (couples list+detail)", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "");
    const r = resolveAgentHomeLink({ kind: "contact", id: "c1" });
    expect(r.disabled).toBe(true);
    if (r.disabled) {
      expect(r.reason).toBe("route-not-available");
    }
  });

  it("ad-set links resolve disabled in slice B", () => {
    const r = resolveAgentHomeLink({ kind: "ad-set", id: "as-1" });
    expect(r.disabled).toBe(true);
  });

  it("creative-job links resolve disabled (phase D)", () => {
    const r = resolveAgentHomeLink({ kind: "creative-job", id: "cj-1" });
    expect(r.disabled).toBe(true);
  });

  it("agent-setup links resolve disabled until route ships", () => {
    const r = resolveAgentHomeLink({ kind: "agent-setup", agentKey: "alex" });
    expect(r.disabled).toBe(true);
  });

  it("all-wins links resolve disabled until route ships", () => {
    const r = resolveAgentHomeLink({ kind: "all-wins", agentKey: "alex" });
    expect(r.disabled).toBe(true);
  });
});
