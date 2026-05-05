// apps/dashboard/src/lib/agent-home/__tests__/resolve-link.test.ts
import { describe, expect, it } from "vitest";
import { resolveAgentHomeLink } from "../resolve-link";

describe("resolveAgentHomeLink", () => {
  it("contact links resolve disabled until /contacts/[id] ships", () => {
    const r = resolveAgentHomeLink({ kind: "contact", id: "c1" });
    expect(r.disabled).toBe(true);
    if (r.disabled) {
      expect(r.href).toBeNull();
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
