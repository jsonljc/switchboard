import { describe, expect, it } from "vitest";
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
    expect(keys.reports.all()).toEqual(["org-1", "reports"]);
    expect(keys.contacts.all()).toEqual(["org-1", "contacts"]);
    expect(keys.automations.all()).toEqual(["org-1", "automations"]);
    expect(keys.activity.all()).toEqual(["org-1", "activity"]);
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

describe("scopedKeys agent-home factories", () => {
  const keys = scopedKeys("org-1");

  it("greeting.feed uses agentKey in key", () => {
    expect(keys.greeting.feed("alex")).toEqual(["org-1", "greeting", "feed", "alex"]);
  });

  it("wins.feed includes window in key for prefix invalidation", () => {
    expect(keys.wins.feed("alex", "today")).toEqual(["org-1", "wins", "feed", "alex", "today"]);
    expect(keys.wins.byAgent("alex")).toEqual(["org-1", "wins", "feed", "alex"]);
  });

  it("metrics.feed includes window in key for prefix invalidation", () => {
    expect(keys.metrics.feed("alex", "week")).toEqual(["org-1", "metrics", "feed", "alex", "week"]);
    expect(keys.metrics.byAgent("alex")).toEqual(["org-1", "metrics", "feed", "alex"]);
  });

  it("pipeline.feed has no window in key", () => {
    expect(keys.pipeline.feed("alex")).toEqual(["org-1", "pipeline", "feed", "alex"]);
  });
});

describe("scopedKeys().opportunities", () => {
  const keys = scopedKeys("org_test");

  it("exposes an `all` prefix scoped to orgId", () => {
    expect(keys.opportunities.all()).toEqual(["org_test", "opportunities"]);
  });

  it("exposes a `board` key under the prefix", () => {
    expect(keys.opportunities.board()).toEqual(["org_test", "opportunities", "board"]);
  });
});

describe("scopedKeys escalations", () => {
  it("scopes escalations.all by org", () => {
    expect(scopedKeys("org_1").escalations.all()).toEqual(["org_1", "escalations"]);
  });

  it("scopes escalations.detail by org + id", () => {
    expect(scopedKeys("org_1").escalations.detail("esc_9")).toEqual([
      "org_1",
      "escalations",
      "detail",
      "esc_9",
    ]);
  });
});
