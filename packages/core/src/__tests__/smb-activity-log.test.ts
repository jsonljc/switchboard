import { describe, it, expect } from "vitest";
import {
  SmbActivityLog,
  InMemorySmbActivityLogStorage,
} from "../smb/activity-log.js";

describe("SmbActivityLog", () => {
  it("should record and query entries", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "digital-ads.campaign.pause",
      result: "allowed",
      amount: 500,
      summary: "Paused campaign",
      snapshot: { campaignId: "camp_1" },
      envelopeId: "env_1",
      organizationId: "org_1",
    });

    await log.record({
      actorId: "user_2",
      actorType: "user",
      actionType: "digital-ads.campaign.create",
      result: "denied",
      amount: 1000,
      summary: "Created campaign",
      snapshot: {},
      envelopeId: "env_2",
      organizationId: "org_1",
    });

    const entries = await log.query({ organizationId: "org_1" });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.id).toMatch(/^act_/);
    expect(entries[0]!.timestamp).toBeInstanceOf(Date);
  });

  it("should filter by actorId", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Test 1",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_1",
    });

    await log.record({
      actorId: "user_2",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Test 2",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_1",
    });

    const entries = await log.query({ organizationId: "org_1", actorId: "user_1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBe("user_1");
  });

  it("should filter by result", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Allowed",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_1",
    });

    await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "denied",
      amount: null,
      summary: "Denied",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_1",
    });

    const entries = await log.query({ organizationId: "org_1", result: "denied" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe("denied");
  });

  it("should apply PII redaction", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    const entry = await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Test",
      snapshot: {
        email: "test@example.com",
        name: "John",
        credentials: "super-secret",
      },
      envelopeId: null,
      organizationId: "org_1",
    });

    expect(entry.redactionApplied).toBe(true);
    expect(entry.redactedFields.length).toBeGreaterThan(0);
    expect(entry.snapshot["credentials"]).toBe("[REDACTED]");
  });

  it("should not have hash chain fields", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    const entry = await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Test",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_1",
    });

    // ActivityLogEntry should NOT have hash chain fields
    expect("entryHash" in entry).toBe(false);
    expect("previousEntryHash" in entry).toBe(false);
    expect("chainHashVersion" in entry).toBe(false);
    expect("evidencePointers" in entry).toBe(false);
  });

  it("should respect limit and offset", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    for (let i = 0; i < 10; i++) {
      await log.record({
        actorId: "user_1",
        actorType: "user",
        actionType: `test_${i}`,
        result: "allowed",
        amount: null,
        summary: `Test ${i}`,
        snapshot: {},
        envelopeId: null,
        organizationId: "org_1",
      });
    }

    const page1 = await log.query({ organizationId: "org_1", limit: 3 });
    expect(page1).toHaveLength(3);

    const page2 = await log.query({ organizationId: "org_1", limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0]!.id).not.toBe(page1[0]!.id);
  });

  it("should scope by organizationId", async () => {
    const storage = new InMemorySmbActivityLogStorage();
    const log = new SmbActivityLog(storage);

    await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Org 1",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_1",
    });

    await log.record({
      actorId: "user_1",
      actorType: "user",
      actionType: "test",
      result: "allowed",
      amount: null,
      summary: "Org 2",
      snapshot: {},
      envelopeId: null,
      organizationId: "org_2",
    });

    const entries = await log.query({ organizationId: "org_1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.organizationId).toBe("org_1");
  });
});
