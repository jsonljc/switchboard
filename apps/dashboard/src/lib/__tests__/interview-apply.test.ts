import { describe, it, expect } from "vitest";
import { applyInterviewUpdate } from "../interview-apply";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { ResponseUpdate } from "../interview-engine";

describe("applyInterviewUpdate", () => {
  it("applies business identity fields", () => {
    const update: ResponseUpdate = {
      section: "businessIdentity",
      fields: { name: "Test Clinic" },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(createEmptyPlaybook(), update);
    expect(result.businessIdentity.name).toBe("Test Clinic");
    expect(result.businessIdentity.status).toBe("check_this");
    expect(result.businessIdentity.source).toBe("interview");
  });

  it("appends new services to existing ones", () => {
    const base = createEmptyPlaybook();
    base.services = [
      {
        id: "existing",
        name: "Existing",
        bookingBehavior: "ask_first",
        status: "ready",
        source: "manual",
      },
    ];
    const update: ResponseUpdate = {
      section: "services",
      fields: { services: [{ name: "New Service", price: 100 }] },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(base, update);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("Existing");
    expect(result.services[1].name).toBe("New Service");
    expect(result.services[1].source).toBe("interview");
  });

  it("stores unparsedInput without overwriting structured fields", () => {
    const update: ResponseUpdate = {
      section: "hours",
      fields: { unparsedInput: "Mon-Fri 9-5" },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(createEmptyPlaybook(), update);
    expect(result.hours.status).toBe("check_this");
    expect(result.hours.source).toBe("interview");
    expect(result.hours.afterHoursBehavior).toBe("");
  });

  it("does not overwrite user edits (source=manual)", () => {
    const base = createEmptyPlaybook();
    base.businessIdentity = {
      ...base.businessIdentity,
      name: "User Entered",
      status: "ready",
      source: "manual",
    };
    const update: ResponseUpdate = {
      section: "businessIdentity",
      fields: { name: "Interview Heard" },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(base, update);
    expect(result.businessIdentity.name).toBe("User Entered");
    expect(result.businessIdentity.status).toBe("ready");
  });
});
