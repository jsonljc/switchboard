// ---------------------------------------------------------------------------
// Tests: Interceptors
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { HIPAARedactor } from "../cartridge/interceptors/hipaa-redactor.js";
import { MedicalClaimFilter } from "../cartridge/interceptors/medical-claim-filter.js";
import { ConsentGate } from "../cartridge/interceptors/consent-gate.js";
import type { CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";

const mockContext: CartridgeContext = {
  principalId: "test",
  organizationId: null,
  connectionCredentials: {},
};

describe("HIPAARedactor", () => {
  const redactor = new HIPAARedactor();

  it("should redact SSN fields", async () => {
    const params = {
      contactId: "p-1",
      ssn: "123-45-6789",
      name: "Alice",
    };

    const { parameters } = await redactor.beforeEnrich!("test", params, mockContext);
    expect(parameters.ssn).toBe("[REDACTED]");
    expect(parameters.contactId).toBe("p-1");
    expect(parameters.name).toBe("Alice");
  });

  it("should redact DOB fields", async () => {
    const params = { dateOfBirth: "1990-01-01", name: "Bob" };
    const { parameters } = await redactor.beforeEnrich!("test", params, mockContext);
    expect(parameters.dateOfBirth).toBe("[REDACTED]");
  });

  it("should redact insurance fields", async () => {
    const params = { insuranceId: "INS-12345", name: "Carol" };
    const { parameters } = await redactor.beforeEnrich!("test", params, mockContext);
    expect(parameters.insuranceId).toBe("[REDACTED]");
  });

  it("should redact SSN patterns in string values", async () => {
    const params = { notes: "Patient SSN is 123-45-6789 on file" };
    const { parameters } = await redactor.beforeEnrich!("test", params, mockContext);
    expect(parameters.notes).toBe("Patient SSN is [REDACTED] on file");
  });

  it("should handle nested objects", async () => {
    const params = {
      patient: { name: "Dave", medicalCondition: "Diabetes" },
    };
    const { parameters } = await redactor.beforeEnrich!("test", params, mockContext);
    const patient = parameters.patient as Record<string, unknown>;
    expect(patient.medicalCondition).toBe("[REDACTED]");
    expect(patient.name).toBe("Dave");
  });
});

describe("MedicalClaimFilter", () => {
  const filter = new MedicalClaimFilter();

  const successResult: ExecuteResult = {
    success: true,
    summary: "Message sent",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 10,
    undoRecipe: null,
  };

  it("should pass clean messages", async () => {
    const result = await filter.afterExecute!(
      "customer-engagement.reminder.send",
      { message: "Your appointment is tomorrow at 2pm." },
      successResult,
      mockContext,
    );
    expect(result.success).toBe(true);
  });

  it("should block messages with 'cure' claims", async () => {
    const result = await filter.afterExecute!(
      "customer-engagement.reminder.send",
      { message: "Our treatment will cure your condition!" },
      successResult,
      mockContext,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("MedicalClaimFilter");
  });

  it("should block 'guaranteed results'", async () => {
    const result = await filter.afterExecute!(
      "customer-engagement.review.respond",
      { responseText: "We guarantee guaranteed results for all patients." },
      successResult,
      mockContext,
    );
    expect(result.success).toBe(false);
  });

  it("should not filter non-outbound actions", async () => {
    const result = await filter.afterExecute!(
      "customer-engagement.lead.score",
      { message: "This is a cure!" },
      successResult,
      mockContext,
    );
    expect(result.success).toBe(true);
  });

  it("should not filter failed results", async () => {
    const failedResult = { ...successResult, success: false };
    const result = await filter.afterExecute!(
      "customer-engagement.reminder.send",
      { message: "This is a cure!" },
      failedResult,
      mockContext,
    );
    expect(result.success).toBe(false);
  });
});

describe("ConsentGate", () => {
  const gate = new ConsentGate();

  it("should allow when consent is active via context", async () => {
    const contextWithConsent: CartridgeContext = {
      ...mockContext,
      connectionCredentials: { consentStatus: "active" },
    };
    const result = await gate.beforeExecute!(
      "customer-engagement.reminder.send",
      {},
      contextWithConsent,
    );
    expect(result.proceed).toBe(true);
  });

  it("should block when consent is not active", async () => {
    const result = await gate.beforeExecute!("customer-engagement.reminder.send", {}, mockContext);
    expect(result.proceed).toBe(false);
    expect(result.reason).toContain("consent");
  });

  it("should not gate non-communication actions", async () => {
    const result = await gate.beforeExecute!("customer-engagement.lead.score", {}, mockContext);
    expect(result.proceed).toBe(true);
  });

  it("should check context connectionCredentials for consent", async () => {
    const contextWithConsent: CartridgeContext = {
      ...mockContext,
      connectionCredentials: { consentStatus: "active" },
    };

    const result = await gate.beforeExecute!(
      "customer-engagement.reminder.send",
      {},
      contextWithConsent,
    );
    expect(result.proceed).toBe(true);
  });
});
