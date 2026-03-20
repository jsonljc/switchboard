import { describe, it, expect } from "vitest";
import { SALES_CLOSER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Sales Closer Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(SALES_CLOSER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lead.qualified events", () => {
    expect(SALES_CLOSER_PORT.inboundEvents).toContain("lead.qualified");
  });

  it("declares only events the handler actually emits", () => {
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("stage.advanced");
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("conversation.escalated");
    expect(SALES_CLOSER_PORT.outboundEvents).not.toContain("revenue.recorded");
  });

  it("declares book_appointment and send_booking_link tools", () => {
    const toolNames = SALES_CLOSER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("book_appointment");
    expect(toolNames).toContain("send_booking_link");
  });
});
