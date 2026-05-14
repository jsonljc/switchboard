import { afterEach, describe, expect, it, vi } from "vitest";
import { isAgentHomeLinkLive, isMercuryToolLive } from "../route-availability";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isMercuryToolLive", () => {
  it.each([
    ["contacts", "NEXT_PUBLIC_CONTACTS_LIVE"],
    ["automations", "NEXT_PUBLIC_AUTOMATIONS_LIVE"],
    ["activity", "NEXT_PUBLIC_ACTIVITY_LIVE"],
    ["reports", "NEXT_PUBLIC_REPORTS_LIVE"],
    ["approvals", "NEXT_PUBLIC_APPROVALS_LIVE"],
  ] as const)("returns true when %s env (%s) === 'true'", (id, envVar) => {
    vi.stubEnv(envVar, "true");
    expect(isMercuryToolLive(id)).toBe(true);
  });

  it.each([
    ["contacts", "NEXT_PUBLIC_CONTACTS_LIVE"],
    ["automations", "NEXT_PUBLIC_AUTOMATIONS_LIVE"],
    ["activity", "NEXT_PUBLIC_ACTIVITY_LIVE"],
    ["reports", "NEXT_PUBLIC_REPORTS_LIVE"],
    ["approvals", "NEXT_PUBLIC_APPROVALS_LIVE"],
  ] as const)("returns false when %s env (%s) is empty", (id, envVar) => {
    vi.stubEnv(envVar, "");
    expect(isMercuryToolLive(id)).toBe(false);
  });

  it.each([
    ["contacts", "NEXT_PUBLIC_CONTACTS_LIVE"],
    ["automations", "NEXT_PUBLIC_AUTOMATIONS_LIVE"],
    ["activity", "NEXT_PUBLIC_ACTIVITY_LIVE"],
    ["reports", "NEXT_PUBLIC_REPORTS_LIVE"],
    ["approvals", "NEXT_PUBLIC_APPROVALS_LIVE"],
  ] as const)("returns false when %s env (%s) is 'false' (only 'true' counts)", (id, envVar) => {
    vi.stubEnv(envVar, "false");
    expect(isMercuryToolLive(id)).toBe(false);
  });

  it("isMercuryToolLive returns false for approvals when value is '1'", () => {
    vi.stubEnv("NEXT_PUBLIC_APPROVALS_LIVE", "1");
    expect(isMercuryToolLive("approvals")).toBe(false);
  });

  it("each tool reads only its own env var (independence)", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_APPROVALS_LIVE", "");
    expect(isMercuryToolLive("contacts")).toBe(true);
    expect(isMercuryToolLive("automations")).toBe(false);
    expect(isMercuryToolLive("activity")).toBe(false);
    expect(isMercuryToolLive("reports")).toBe(false);
    expect(isMercuryToolLive("approvals")).toBe(false);
  });
});

describe("isAgentHomeLinkLive", () => {
  it("contact defers to isMercuryToolLive('contacts'): true when env is 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
    expect(isAgentHomeLinkLive("contact")).toBe(true);
  });

  it("contact defers to isMercuryToolLive('contacts'): false when env is empty", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "");
    expect(isAgentHomeLinkLive("contact")).toBe(false);
  });

  it.each(["ad-set", "creative-job", "agent-setup", "all-wins"] as const)(
    "%s is not yet live (returns false regardless of env)",
    (kind) => {
      vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
      vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", "true");
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "true");
      expect(isAgentHomeLinkLive(kind)).toBe(false);
    },
  );
});
