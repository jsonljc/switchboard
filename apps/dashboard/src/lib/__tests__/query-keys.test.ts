import { describe, it, expect } from "vitest";
import { scopedKeys } from "../query-keys";

describe("scopedKeys", () => {
  it("prefixes every key with the orgId", () => {
    const keys = scopedKeys("org-1");
    expect(keys.identity.all()).toEqual(["org-1", "identity"]);
    expect(keys.identity.spec("p-1")).toEqual(["org-1", "identity", "spec", "p-1"]);
    expect(keys.identity.specById("id-1")).toEqual(["org-1", "identity", "spec-by-id", "id-1"]);
    expect(keys.approvals.all()).toEqual(["org-1", "approvals"]);
    expect(keys.approvals.pending()).toEqual(["org-1", "approvals", "pending"]);
    expect(keys.approvals.detail("a-1")).toEqual(["org-1", "approvals", "detail", "a-1"]);
    expect(keys.audit.all()).toEqual(["org-1", "audit"]);
    expect(keys.audit.list({ eventType: "x" })).toEqual([
      "org-1",
      "audit",
      "list",
      { eventType: "x" },
    ]);
    expect(keys.dashboard.all()).toEqual(["org-1", "dashboard"]);
    expect(keys.dashboard.overview()).toEqual(["org-1", "dashboard", "overview"]);
    expect(keys.escalations.all()).toEqual(["org-1", "escalations"]);
    expect(keys.governance.all()).toEqual(["org-1", "governance"]);
    expect(keys.governance.status("current")).toEqual(["org-1", "governance", "status", "current"]);
    expect(keys.persona.mine()).toEqual(["org-1", "persona", "mine"]);
    expect(keys.playbook.current()).toEqual(["org-1", "playbook", "current"]);
    expect(keys.modules.status()).toEqual(["org-1", "modules", "status"]);
    expect(keys.tasks.all()).toEqual(["org-1", "tasks"]);
    expect(keys.tasks.list({ status: "open" })).toEqual([
      "org-1",
      "tasks",
      "list",
      { status: "open" },
    ]);
    expect(keys.marketplace.listings()).toEqual(["org-1", "marketplace", "listings", undefined]);
    expect(keys.marketplace.faqDrafts("d-1")).toEqual([
      "org-1",
      "marketplace",
      "faq-drafts",
      "d-1",
    ]);
    expect(keys.creativeJobs.detail("j-1")).toEqual(["org-1", "creativeJobs", "detail", "j-1"]);
    expect(keys.adOptimizer.audit("d-1")).toEqual(["org-1", "adOptimizer", "audit", "d-1"]);
    expect(keys.connections.list()).toEqual(["org-1", "connections", "list"]);
    expect(keys.channels.all()).toEqual(["org-1", "channels"]);
    expect(keys.channels.list()).toEqual(["org-1", "channels", "list"]);
    expect(keys.orgConfig.current()).toEqual(["org-1", "orgConfig", "current"]);
    expect(keys.knowledge.documents("agent-1")).toEqual([
      "org-1",
      "knowledge",
      "documents",
      "agent-1",
    ]);
    expect(keys.agents.roster()).toEqual(["org-1", "agents", "roster"]);
    expect(keys.agents.activity()).toEqual(["org-1", "agents", "activity"]);
    expect(keys.conversations.list({ status: "open" })).toEqual([
      "org-1",
      "conversations",
      "list",
      { status: "open" },
    ]);
    expect(keys.conversations.detail("c-1")).toEqual(["org-1", "conversations", "detail", "c-1"]);
  });

  it("produces different keys for different orgs", () => {
    const a = scopedKeys("org-a");
    const b = scopedKeys("org-b");
    expect(a.dashboard.overview()).not.toEqual(b.dashboard.overview());
    expect(a.approvals.pending()).not.toEqual(b.approvals.pending());
    expect(a.identity.all()).toEqual(["org-a", "identity"]);
    expect(b.identity.all()).toEqual(["org-b", "identity"]);
  });
});
