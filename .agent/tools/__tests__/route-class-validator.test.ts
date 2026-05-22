import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { parseRouteClass, validateRouteClass } from "../route-class-validator.js";

function makeSource(content: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("test.ts", content);
}

describe("parseRouteClass", () => {
  it("extracts class from header comment", () => {
    const sf = makeSource(`// @route-class: operator-direct\nexport const x = 1;`);
    expect(parseRouteClass(sf)).toBe("operator-direct");
  });

  it("returns null when no header present", () => {
    const sf = makeSource(`export const x = 1;`);
    expect(parseRouteClass(sf)).toBeNull();
  });

  it("handles class labels with hyphens", () => {
    const sf = makeSource(`// @route-class: ingress-receiver\nexport const x = 1;`);
    expect(parseRouteClass(sf)).toBe("ingress-receiver");
  });

  it("returns null for unknown class labels", () => {
    const sf = makeSource(`// @route-class: not-a-real-class\nexport const x = 1;`);
    expect(parseRouteClass(sf)).toBeNull();
  });
});

describe("validateRouteClass — operator-direct", () => {
  it("returns no warnings when route uses requireIdempotencyKey + requireOrgForMutation correctly", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const key = requireIdempotencyKey(req, reply);
        });
      };
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });

  it("warns when operator-direct route does not import requireIdempotencyKey", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", { preHandler: requireOrgForMutation }, async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/requireIdempotencyKey/);
  });

  it("warns when operator-direct route does not import requireOrgForMutation", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      export const r = async (app) => {
        app.post("/x", async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/requireOrgForMutation/);
  });

  it("warns when requireIdempotencyKey is imported but never called", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", { preHandler: requireOrgForMutation }, async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /imports requireIdempotencyKey but never calls/,
    );
  });

  it("warns when requireOrgForMutation is imported but not registered as preHandler", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /imports requireOrgForMutation but does not register/,
    );
  });

  it("warns when there are more mutating handlers than requireIdempotencyKey calls", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/a", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        // Second mutating handler — does NOT call requireIdempotencyKey.
        app.patch("/b", { preHandler: requireOrgForMutation }, async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /registers 2 mutating handler\(s\) but only calls requireIdempotencyKey 1 time/,
    );
  });

  it("does NOT warn for GET handlers in operator-direct file (admin-consent mixed-class compromise)", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.get("/x/:id", { preHandler: requireOrg }, async () => {});
        app.post("/x/grant", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        app.post("/x/revoke", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        app.post("/x/clear", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });
});

describe("validateRouteClass — read-only", () => {
  it("returns no warnings when read-only route imports requireOrg", () => {
    const sf = makeSource(`
      // @route-class: read-only
      import { requireOrg } from "../decorators/require-org.js";
      export const r = async () => {};
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });

  it("warns when read-only route imports requireOrgForMutation (write-side guard on read route)", () => {
    const sf = makeSource(`
      // @route-class: read-only
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async () => {};
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/requireOrgForMutation/);
  });
});

describe("validateRouteClass — control-plane / lifecycle / ingress-receiver", () => {
  it("returns no warnings for control-plane (relaxed in PR-1)", () => {
    const sf = makeSource(`
      // @route-class: control-plane
      export const r = async () => {};
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });
});

describe("validateRouteClass — no header", () => {
  it("returns no warnings when no header present (PR-4 backfills; PR-1 is touched-only)", () => {
    const sf = makeSource(`export const r = async () => {};`);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });
});
