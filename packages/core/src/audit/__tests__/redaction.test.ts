import { describe, it, expect } from "vitest";
import { redactSnapshot, DEFAULT_REDACTION_CONFIG, type RedactionConfig } from "../redaction.js";

describe("DEFAULT_REDACTION_CONFIG", () => {
  it("has expected field paths for sensitive data", () => {
    expect(DEFAULT_REDACTION_CONFIG.fieldPaths).toContain("credentials");
    expect(DEFAULT_REDACTION_CONFIG.fieldPaths).toContain("password");
    expect(DEFAULT_REDACTION_CONFIG.fieldPaths).toContain("secret");
    expect(DEFAULT_REDACTION_CONFIG.fieldPaths).toContain("apiKey");
    expect(DEFAULT_REDACTION_CONFIG.fieldPaths).toContain("accessToken");
    expect(DEFAULT_REDACTION_CONFIG.fieldPaths).toContain("refreshToken");
  });

  it("uses [REDACTED] as the default replacement", () => {
    expect(DEFAULT_REDACTION_CONFIG.replacement).toBe("[REDACTED]");
  });

  it("has patterns for email, phone, API tokens, and credit cards", () => {
    expect(DEFAULT_REDACTION_CONFIG.patterns).toHaveLength(4);
  });
});

describe("redactSnapshot", () => {
  describe("field path redaction", () => {
    it("redacts top-level sensitive fields", () => {
      const snapshot = {
        name: "John",
        password: "super-secret-123",
        apiKey: "sk_live_abc123def456",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.name).toBe("John");
      expect(result.redacted.password).toBe("[REDACTED]");
      expect(result.redacted.apiKey).toBe("[REDACTED]");
      expect(result.redactedFields).toContain("password");
      expect(result.redactedFields).toContain("apiKey");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts nested sensitive fields", () => {
      const snapshot = {
        config: {
          credentials: { username: "admin", password: "pass123" },
          timeout: 30,
        },
      };
      const result = redactSnapshot(snapshot);

      expect((result.redacted.config as Record<string, unknown>).credentials).toBe("[REDACTED]");
      expect((result.redacted.config as Record<string, unknown>).timeout).toBe(30);
      expect(result.redactedFields).toContain("config.credentials");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts accessToken and refreshToken fields", () => {
      const snapshot = {
        auth: {
          accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
          refreshToken: "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4",
        },
      };
      const result = redactSnapshot(snapshot);

      const auth = result.redacted.auth as Record<string, unknown>;
      expect(auth.accessToken).toBe("[REDACTED]");
      expect(auth.refreshToken).toBe("[REDACTED]");
      expect(result.redactedFields).toContain("auth.accessToken");
      expect(result.redactedFields).toContain("auth.refreshToken");
    });

    it("redacts secret fields at any nesting depth", () => {
      const snapshot = {
        level1: {
          level2: {
            level3: {
              secret: "deeply-nested-secret",
            },
          },
        },
      };
      const result = redactSnapshot(snapshot);

      const level3 = (
        (result.redacted.level1 as Record<string, unknown>).level2 as Record<string, unknown>
      ).level3 as Record<string, unknown>;
      expect(level3.secret).toBe("[REDACTED]");
      expect(result.redactedFields).toContain("level1.level2.level3.secret");
    });
  });

  describe("pattern-based redaction", () => {
    it("redacts email addresses in string values", () => {
      const snapshot = {
        message: "Contact us at support@example.com for help",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.message).toBe("Contact us at [REDACTED] for help");
      expect(result.redactedFields).toContain("message");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts phone numbers", () => {
      const snapshot = {
        contact: "Call 555-123-4567 for support",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.contact).toBe("Call [REDACTED] for support");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts phone numbers with dots", () => {
      const snapshot = {
        phone: "555.123.4567",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.phone).toBe("[REDACTED]");
    });

    it("redacts phone numbers without separators", () => {
      const snapshot = {
        phone: "5551234567",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.phone).toBe("[REDACTED]");
    });

    it("redacts API tokens matching token patterns", () => {
      const snapshot = {
        config: "Use token sk_abcdefghijklmnopqrstuv12345 for auth",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.config).toBe("Use token [REDACTED] for auth");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts credit card numbers with spaces", () => {
      const snapshot = {
        payment: "Card: 4111 1111 1111 1111",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.payment).toBe("Card: [REDACTED]");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts credit card numbers with dashes", () => {
      const snapshot = {
        payment: "Card: 4111-1111-1111-1111",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.payment).toBe("Card: [REDACTED]");
    });

    it("redacts multiple patterns in the same string", () => {
      const snapshot = {
        message: "Email user@example.com or call 555-123-4567",
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.message).toBe("Email [REDACTED] or call [REDACTED]");
      expect(result.redactedFields).toContain("message");
    });
  });

  describe("arrays", () => {
    it("redacts sensitive data inside arrays", () => {
      const snapshot = {
        contacts: ["user1@example.com", "user2@example.com"],
      };
      const result = redactSnapshot(snapshot);

      const contacts = result.redacted.contacts as string[];
      expect(contacts[0]).toBe("[REDACTED]");
      expect(contacts[1]).toBe("[REDACTED]");
      expect(result.redactionApplied).toBe(true);
    });

    it("redacts objects within arrays", () => {
      const snapshot = {
        users: [
          { name: "Alice", password: "pass1" },
          { name: "Bob", password: "pass2" },
        ],
      };
      const result = redactSnapshot(snapshot);

      const users = result.redacted.users as Array<Record<string, unknown>>;
      expect(users[0]!.name).toBe("Alice");
      expect(users[0]!.password).toBe("[REDACTED]");
      expect(users[1]!.name).toBe("Bob");
      expect(users[1]!.password).toBe("[REDACTED]");
    });
  });

  describe("no redaction needed", () => {
    it("returns original data when no sensitive content is found", () => {
      const snapshot = {
        name: "Test Campaign",
        budget: 5000,
        active: true,
      };
      const result = redactSnapshot(snapshot);

      expect(result.redacted).toEqual(snapshot);
      expect(result.redactedFields).toEqual([]);
      expect(result.redactionApplied).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles null values in snapshot", () => {
      const snapshot = {
        name: "test",
        value: null,
      };
      const result = redactSnapshot(snapshot as Record<string, unknown>);

      expect(result.redacted.value).toBeNull();
    });

    it("handles undefined values in snapshot", () => {
      const snapshot = {
        name: "test",
        value: undefined,
      };
      const result = redactSnapshot(snapshot as Record<string, unknown>);

      expect(result.redacted.value).toBeUndefined();
    });

    it("handles empty object", () => {
      const result = redactSnapshot({});

      expect(result.redacted).toEqual({});
      expect(result.redactedFields).toEqual([]);
      expect(result.redactionApplied).toBe(false);
    });

    it("handles numeric values without redaction", () => {
      const snapshot = { count: 42, ratio: 0.95 };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.count).toBe(42);
      expect(result.redacted.ratio).toBe(0.95);
      expect(result.redactionApplied).toBe(false);
    });

    it("handles boolean values without redaction", () => {
      const snapshot = { active: true, deleted: false };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.active).toBe(true);
      expect(result.redacted.deleted).toBe(false);
      expect(result.redactionApplied).toBe(false);
    });

    it("handles empty arrays", () => {
      const snapshot = { items: [] };
      const result = redactSnapshot(snapshot);

      expect(result.redacted.items).toEqual([]);
      expect(result.redactionApplied).toBe(false);
    });
  });

  describe("custom config", () => {
    it("uses custom replacement text", () => {
      const config: RedactionConfig = {
        patterns: [],
        fieldPaths: ["secret"],
        replacement: "***",
      };
      const snapshot = { secret: "my-secret", name: "test" };
      const result = redactSnapshot(snapshot, config);

      expect(result.redacted.secret).toBe("***");
      expect(result.redacted.name).toBe("test");
    });

    it("uses custom patterns", () => {
      const config: RedactionConfig = {
        patterns: [/\bSSN-\d{3}-\d{2}-\d{4}\b/g],
        fieldPaths: [],
        replacement: "[SSN_REMOVED]",
      };
      const snapshot = { data: "User SSN-123-45-6789 info" };
      const result = redactSnapshot(snapshot, config);

      expect(result.redacted.data).toBe("User [SSN_REMOVED] info");
      expect(result.redactionApplied).toBe(true);
    });

    it("uses custom field paths", () => {
      const config: RedactionConfig = {
        patterns: [],
        fieldPaths: ["customSecret", "internalId"],
        replacement: "[HIDDEN]",
      };
      const snapshot = {
        customSecret: "value1",
        internalId: "value2",
        publicField: "visible",
      };
      const result = redactSnapshot(snapshot, config);

      expect(result.redacted.customSecret).toBe("[HIDDEN]");
      expect(result.redacted.internalId).toBe("[HIDDEN]");
      expect(result.redacted.publicField).toBe("visible");
    });

    it("empty config does not redact anything", () => {
      const config: RedactionConfig = {
        patterns: [],
        fieldPaths: [],
        replacement: "[REDACTED]",
      };
      const snapshot = {
        password: "visible",
        email: "user@example.com",
      };
      const result = redactSnapshot(snapshot, config);

      expect(result.redacted.password).toBe("visible");
      expect(result.redacted.email).toBe("user@example.com");
      expect(result.redactionApplied).toBe(false);
    });
  });
});
