import { describe, it, expect } from "vitest";
import { AI_DISCLOSURE_VERSIONS } from "@switchboard/schemas";
import { DISCLOSURE_COPY } from "../disclosure-copy.js";

describe("DISCLOSURE_COPY", () => {
  it("has SG and MY records with the AI_DISCLOSURE_VERSIONS version", () => {
    expect(DISCLOSURE_COPY.SG.version).toBe(AI_DISCLOSURE_VERSIONS.SG);
    expect(DISCLOSURE_COPY.MY.version).toBe(AI_DISCLOSURE_VERSIONS.MY);
  });

  it("SG text introduces Alex as the clinic's AI assistant (transparency posture)", () => {
    expect(DISCLOSURE_COPY.SG.text).toMatch(/AI assistant/i);
    expect(DISCLOSURE_COPY.SG.text).toMatch(/clinic/i);
  });

  it("MY text includes the explicit consent prompt (PDPA explicit-consent regime)", () => {
    expect(DISCLOSURE_COPY.MY.text).toMatch(/AI assistant/i);
    expect(DISCLOSURE_COPY.MY.text).toMatch(/Reply OK/i);
    expect(DISCLOSURE_COPY.MY.text).toMatch(/STOP/i);
  });

  it("matches frozen snapshots (prevents accidental copy drift)", () => {
    expect(DISCLOSURE_COPY).toMatchSnapshot();
  });
});
