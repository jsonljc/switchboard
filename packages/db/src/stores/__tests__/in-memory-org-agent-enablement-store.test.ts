import { describe, expect, it } from "vitest";
import { createInMemoryOrgAgentEnablementStore } from "../in-memory-org-agent-enablement-store.js";

describe("InMemoryOrgAgentEnablementStore", () => {
  it("starts empty", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    expect(await store.list("org-1")).toEqual([]);
  });

  it("enable upserts a row with status='enabled' and timestamps", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    const row = await store.enable("org-1", "alex");
    expect(row.orgId).toBe("org-1");
    expect(row.agentKey).toBe("alex");
    expect(row.status).toBe("enabled");
    expect(row.enabledAt).toBeInstanceOf(Date);
  });

  it("enable is idempotent on (orgId, agentKey)", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    const a = await store.enable("org-1", "alex");
    const b = await store.enable("org-1", "alex");
    expect(b.id).toBe(a.id);
    expect((await store.list("org-1")).length).toBe(1);
  });

  it("list scopes by orgId", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    await store.enable("org-1", "alex");
    await store.enable("org-2", "riley");
    expect(await store.list("org-1")).toHaveLength(1);
    expect((await store.list("org-1"))[0]!.agentKey).toBe("alex");
    expect(await store.list("org-2")).toHaveLength(1);
  });

  it("setStatus updates an existing row", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    await store.enable("org-1", "mira");
    await store.setStatus("org-1", "mira", "disabled");
    const rows = await store.list("org-1");
    expect(rows[0]!.status).toBe("disabled");
  });

  it("setStatus is a no-op if no row exists", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    await expect(store.setStatus("org-1", "mira", "disabled")).resolves.toBeUndefined();
    expect(await store.list("org-1")).toEqual([]);
  });
});
