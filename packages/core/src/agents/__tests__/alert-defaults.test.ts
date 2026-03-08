import { describe, it, expect } from "vitest";
import { DEFAULT_ALERT_TEMPLATES, buildDefaultAlertRules } from "../alert-defaults.js";

describe("DEFAULT_ALERT_TEMPLATES", () => {
  it("contains 5 default templates", () => {
    expect(DEFAULT_ALERT_TEMPLATES).toHaveLength(5);
  });

  it("each template has required fields", () => {
    for (const template of DEFAULT_ALERT_TEMPLATES) {
      expect(template.name).toBeTruthy();
      expect(template.metricPath).toBeTruthy();
      expect(template.operator).toBeTruthy();
      expect(typeof template.threshold).toBe("number");
      expect(typeof template.cooldownMinutes).toBe("number");
      expect(template.cooldownMinutes).toBeGreaterThan(0);
      expect(template.description).toBeTruthy();
    }
  });

  it("includes all expected alert types", () => {
    const names = DEFAULT_ALERT_TEMPLATES.map((t) => t.name);
    expect(names).toContain("Daily overspend");
    expect(names).toContain("CPL spike");
    expect(names).toContain("Ad disapproved");
    expect(names).toContain("No leads in 48h");
    expect(names).toContain("Campaign budget exhausted");
  });
});

describe("buildDefaultAlertRules", () => {
  it("creates rules for all templates", () => {
    const rules = buildDefaultAlertRules("org_dental", ["telegram"], ["chat_1"]);
    expect(rules).toHaveLength(5);
  });

  it("sets organization and notification fields", () => {
    const rules = buildDefaultAlertRules("org_dental", ["telegram", "slack"], ["chat_1", "C123"]);

    for (const rule of rules) {
      expect(rule.organizationId).toBe("org_dental");
      expect(rule.enabled).toBe(true);
      expect(rule.notifyChannels).toEqual(["telegram", "slack"]);
      expect(rule.notifyRecipients).toEqual(["chat_1", "C123"]);
    }
  });

  it("preserves template thresholds", () => {
    const rules = buildDefaultAlertRules("org_1", ["telegram"], ["chat_1"]);
    const overspend = rules.find((r) => r.name === "Daily overspend");
    expect(overspend).toBeDefined();
    expect(overspend!.threshold).toBe(1.2);
    expect(overspend!.operator).toBe("gt");
  });

  it("preserves cooldown from template", () => {
    const rules = buildDefaultAlertRules("org_1", ["telegram"], ["chat_1"]);
    const noLeads = rules.find((r) => r.name === "No leads in 48h");
    expect(noLeads).toBeDefined();
    expect(noLeads!.cooldownMinutes).toBe(60 * 24);
  });
});
