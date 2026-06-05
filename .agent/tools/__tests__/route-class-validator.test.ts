import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import {
  parseRouteClass,
  resolveRouteClass,
  validateControlPlaneOrgGuard,
  validateRouteClass,
} from "../route-class-validator.js";

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

  it("warns when operator-direct route does not import any write-side decorator", () => {
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
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/write-side decorator/);
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

  it("warns when a write-side decorator is imported but not registered as preHandler", () => {
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
      /imports a write-side decorator but does not register/,
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

  it("does NOT false-count a sibling identifier whose name only ends with requireIdempotencyKey (suffix-match regression)", () => {
    // Regression test for PR #614 ultrareview bug_005: when `callsNamed` used
    // `endsWith(name)`, a locally-defined wrapper like
    // `wrapRequireIdempotencyKey(...)` would false-match and inflate the call
    // count, masking the cardinality check on a second mutating handler that
    // forgot to call the real helper.
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      function wrapRequireIdempotencyKey(req: unknown, reply: unknown) {
        return "k";
      }
      export const r = async (app) => {
        app.post("/a", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        // Second handler uses the wrapper, NOT the real helper — should warn.
        app.patch("/b", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = wrapRequireIdempotencyKey(req, reply);
        });
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /registers 2 mutating handler\(s\) but only calls requireIdempotencyKey 1 time/,
    );
  });

  it("accepts requireOrgForAuditedMutation as satisfying the operator-direct decorator requirement", () => {
    // PR #614 ultrareview bug_003: PDPA-grade routes use the audited variant
    // instead of the plain requireOrgForMutation. The validator must treat
    // either decorator as satisfying the operator-direct contract.
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrg, requireOrgForAuditedMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.get("/x/:id", { preHandler: requireOrg }, async () => {});
        app.post("/x/grant", { preHandler: requireOrgForAuditedMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
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
    expect(warnings[0].message).toMatch(/write-side/);
  });

  it("warns when read-only route imports requireOrgForAuditedMutation (write-side guard on read route)", () => {
    const sf = makeSource(`
      // @route-class: read-only
      import { requireOrgForAuditedMutation } from "../decorators/require-org.js";
      export const r = async () => {};
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/write-side/);
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

describe("operator-direct contract-deferred directive", () => {
  // Minimal operator-direct file with no decorators (no directive either).
  // Used as baseline to confirm existing warnings still fire without the directive.
  const BARE_OP_DIRECT = `
    // @route-class: operator-direct
    export const r = async (app) => {
      app.post("/x", async () => {});
    };
  `;

  it("no directive, no decorators → existing warnings still fire (unchanged behavior)", () => {
    const sf = makeSource(BARE_OP_DIRECT);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("directive WITH issue ref (#654) on same line, no decorators → returns [] (cell checks skipped)", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      // route-governance: operator-direct-contract-deferred — migration tracked in #654
      export const r = async (app) => {
        app.post("/x", async () => {});
      };
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });

  it("directive WITH issue ref on a following rationale line, no decorators → returns []", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      // route-governance: operator-direct-contract-deferred — will wire decorators in
      //   the migration-free pass; see issue
      //   #654 for tracking
      export const r = async (app) => {
        app.post("/x", async () => {});
      };
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });

  it("directive WITHOUT any issue ref, no decorators → exactly ONE warning about missing issue reference", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      // route-governance: operator-direct-contract-deferred — no rationale or issue here
      export const r = async (app) => {
        app.post("/x", async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/without a tracked issue reference/);
  });

  it("directive present, route IS fully wired → returns [] (directive is harmless on compliant route)", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      // route-governance: operator-direct-contract-deferred — already wired, ref #654
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

  it("read-only route with the directive → directive has no effect (read-only rule unchanged)", () => {
    const sf = makeSource(`
      // @route-class: read-only
      // route-governance: operator-direct-contract-deferred — should be ignored for read-only
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async () => {};
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    // read-only with write-side import still warns; directive doesn't suppress it
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/write-side/);
  });
});

describe("dashboard-proxy directory convention", () => {
  it("returns 'dashboard-proxy' for a route under apps/dashboard/src/app/api/dashboard/ with no header", () => {
    const sf = makeSource(`export const r = async () => {};`);
    expect(resolveRouteClass(sf, "apps/dashboard/src/app/api/dashboard/overview/route.ts")).toBe(
      "dashboard-proxy",
    );
  });

  it("returns the explicit class when a dashboard/api/dashboard/ route has an explicit header", () => {
    const sf = makeSource(`// @route-class: operator-direct\nexport const r = async () => {};`);
    expect(resolveRouteClass(sf, "apps/dashboard/src/app/api/dashboard/overview/route.ts")).toBe(
      "operator-direct",
    );
  });

  it("returns null for a non-dashboard api route with no header", () => {
    const sf = makeSource(`export const r = async () => {};`);
    expect(resolveRouteClass(sf, "apps/api/src/routes/widgets.ts")).toBeNull();
  });

  it("returns the explicit class for a non-dashboard api route with an explicit header", () => {
    const sf = makeSource(`// @route-class: control-plane\nexport const r = async () => {};`);
    expect(resolveRouteClass(sf, "apps/api/src/routes/widgets.ts")).toBe("control-plane");
  });

  it("narrowing guard: a dashboard route OUTSIDE /dashboard/ (waitlist) with no header returns null, NOT dashboard-proxy", () => {
    // routes under apps/dashboard/src/app/api/ but OUTSIDE /dashboard/ (e.g.
    // waitlist/route.ts which does a direct db.waitlistEntry.create) are NOT
    // forwarding proxies — they must carry an explicit @route-class header.
    const sf = makeSource(`export const r = async () => {};`);
    expect(resolveRouteClass(sf, "apps/dashboard/src/app/api/waitlist/route.ts")).toBeNull();
  });

  it("narrowing guard: a dashboard route OUTSIDE /dashboard/ (auth) with no header returns null, NOT dashboard-proxy", () => {
    // auth/* routes are not forwarding proxies and must carry explicit headers.
    const sf = makeSource(`export const r = async () => {};`);
    expect(resolveRouteClass(sf, "apps/dashboard/src/app/api/auth/register/route.ts")).toBeNull();
  });

  it("parseRouteClass recognises 'dashboard-proxy' as a known class", () => {
    const sf = makeSource(`// @route-class: dashboard-proxy\nexport const r = async () => {};`);
    expect(parseRouteClass(sf)).toBe("dashboard-proxy");
  });

  it("returns 'dashboard-proxy' for a deeply-nested dashboard route with no header", () => {
    const sf = makeSource(`export const r = async () => {};`);
    expect(
      resolveRouteClass(sf, "apps/dashboard/src/app/api/dashboard/meta/insights/daily/route.ts"),
    ).toBe("dashboard-proxy");
  });
});

describe("validateControlPlaneOrgGuard", () => {
  // WARN-ONLY advisory: a mutating control-plane route that imports NONE of the
  // recognized org-scoping guards should produce exactly one ADVISORY warning.
  // This is wired NON-BLOCKING in check-routes.ts (does not affect exitCode);
  // full error-mode enforcement is staged behind the org-guard backfill (#654).

  it("warns once for control-plane + .post handler + NO guard import", () => {
    const sf = makeSource(`
      // @route-class: control-plane
      export const r = async (app) => {
        app.post("/x", async () => {});
      };
    `);
    const warnings = validateControlPlaneOrgGuard(sf, "test.ts");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/Route Governance §12 \(tracked: #654\)/);
  });

  it("returns [] for control-plane + .post + requireOrganizationScope imported", () => {
    const sf = makeSource(`
      // @route-class: control-plane
      import { requireOrganizationScope } from "../utils/require-org.js";
      export const r = async (app) => {
        app.post("/x", async () => {});
      };
    `);
    expect(validateControlPlaneOrgGuard(sf, "test.ts")).toEqual([]);
  });

  it("returns [] for control-plane + .patch + assertOrgAccess imported", () => {
    const sf = makeSource(`
      // @route-class: control-plane
      import { assertOrgAccess } from "../utils/org-access.js";
      export const r = async (app) => {
        app.patch("/x", async () => {});
      };
    `);
    expect(validateControlPlaneOrgGuard(sf, "test.ts")).toEqual([]);
  });

  it("returns [] for control-plane with only a .get handler (no mutating handler)", () => {
    const sf = makeSource(`
      // @route-class: control-plane
      export const r = async (app) => {
        app.get("/x", async () => {});
      };
    `);
    expect(validateControlPlaneOrgGuard(sf, "test.ts")).toEqual([]);
  });

  it("returns [] for a non-control-plane class (operator-direct), even unguarded + mutating", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      export const r = async (app) => {
        app.post("/x", async () => {});
      };
    `);
    expect(validateControlPlaneOrgGuard(sf, "test.ts")).toEqual([]);
  });
});
