import { describe, it, expect } from "vitest";
import { REVOCATION_ACK } from "../revocation-ack.js";

describe("REVOCATION_ACK", () => {
  it("acknowledges revocation without medical/safety language", () => {
    expect(REVOCATION_ACK.SG).toMatch(/won't message you/i);
    expect(REVOCATION_ACK.MY).toMatch(/stop messaging/i);
  });

  it("matches frozen snapshots", () => {
    expect(REVOCATION_ACK).toMatchSnapshot();
  });
});
