import { describe, expect, it } from "vitest";
import { resolveTreatmentInterest } from "../treatment-resolver.js";
import type { Playbook } from "@switchboard/schemas";

function fakePlaybook(serviceNames: string[]): Playbook {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessIdentity: {} as any,
    services: serviceNames.map((name, i) => ({
      id: `svc_${i}`,
      name,
      bookingBehavior: "ask_first",
      status: "complete",
      source: "manual",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as Playbook;
}

describe("resolveTreatmentInterest", () => {
  it("matches case-insensitively on trimmed name", () => {
    const playbook = fakePlaybook(["HIFU", "Laser Hair Removal"]);
    expect(resolveTreatmentInterest(playbook, "hifu")).toEqual({
      resolved: true,
      serviceId: "svc_0",
      serviceName: "HIFU",
    });
    expect(resolveTreatmentInterest(playbook, "  Laser Hair Removal  ")).toEqual({
      resolved: true,
      serviceId: "svc_1",
      serviceName: "Laser Hair Removal",
    });
  });

  it("returns unresolved for unknown treatment names", () => {
    const playbook = fakePlaybook(["HIFU"]);
    expect(resolveTreatmentInterest(playbook, "laser miracle fat removal")).toEqual({
      resolved: false,
      candidate: "laser miracle fat removal",
    });
  });

  it("returns null-typed result for null input", () => {
    const playbook = fakePlaybook(["HIFU"]);
    expect(resolveTreatmentInterest(playbook, null)).toEqual({
      resolved: false,
      candidate: null,
    });
  });

  it("returns null-typed result for empty/whitespace input", () => {
    const playbook = fakePlaybook(["HIFU"]);
    expect(resolveTreatmentInterest(playbook, "   ")).toEqual({
      resolved: false,
      candidate: null,
    });
  });

  it("returns unresolved when playbook has no services", () => {
    const playbook = fakePlaybook([]);
    expect(resolveTreatmentInterest(playbook, "HIFU")).toEqual({
      resolved: false,
      candidate: "HIFU",
    });
  });
});
