/**
 * Shared harness for the EV-14 cross-tenant route sweep (CHAN-1).
 *
 * Mirrors the auth scaffolding of `cross-tenant-isolation.test.ts`: a Fastify
 * instance running in auth-ENABLED mode whose preHandler maps bearer tokens to
 * orgs (KEY_A -> ORG_A, KEY_B -> ORG_B, UNSCOPED_KEY -> no org binding). Every
 * route under test derives its org from `request.organizationIdFromAuth`, never
 * from a client-supplied value, so a request authenticated as ORG_A can only
 * ever reach ORG_A's rows.
 *
 * `orgTable` is a faithful in-memory Prisma-model fake: it APPLIES the scalar
 * `where` filter it is given (including `organizationId`). That faithfulness is
 * what gives the sweep teeth — if a route dropped `organizationId` from its
 * WHERE, the fake would return another org's rows and the behavioral assertions
 * (plus the `toHaveBeenCalledWith(... organizationId ...)` call-arg assertions)
 * would go red. This is test-only: it pins EXISTING isolation, it does not
 * change any production code.
 */
import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import { vi } from "vitest";

export const ORG_A = "org_A";
export const ORG_B = "org_B";
export const KEY_A = "key-org-a";
export const KEY_B = "key-org-b";
export const UNSCOPED_KEY = "key-unscoped";

export const HEADERS_A = { authorization: `Bearer ${KEY_A}` };
export const HEADERS_B = { authorization: `Bearer ${KEY_B}` };
export const HEADERS_UNSCOPED = { authorization: `Bearer ${UNSCOPED_KEY}` };

/**
 * Build a Fastify app in auth-ENABLED mode with the production-like bearer ->
 * org preHandler. The caller decorates the stores its route needs and registers
 * the route, then awaits `app.ready()`.
 */
export async function baseScopedApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // Auth ENABLED — the production-like configuration that fails closed on an
  // unscoped/missing org binding (assertOrgAccess / requireOrganizationScope).
  app.decorate("authDisabled", false);
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);

  app.addHook("preHandler", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth) {
      return reply.code(401).send({ error: "Missing Authorization header", statusCode: 401 });
    }
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    const key = match?.[1];
    if (key === KEY_A) {
      request.organizationIdFromAuth = ORG_A;
      request.principalIdFromAuth = "principal_A";
    } else if (key === KEY_B) {
      request.organizationIdFromAuth = ORG_B;
      request.principalIdFromAuth = "principal_B";
    } else if (key === UNSCOPED_KEY) {
      // Unscoped key — auth succeeds but org binding is undefined. The fail-closed
      // contract: org-scoped routes must reject with 403, never treat this as dev mode.
      request.organizationIdFromAuth = undefined;
      request.principalIdFromAuth = "principal_unscoped";
    } else {
      return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
    }
  });

  return app;
}

type Where = Record<string, unknown> | undefined;

/** AND of scalar equality across every key in `where`. Nested objects (relation
 *  filters, `select`, operators) are ignored — none of the swept routes use them
 *  for org scoping, and ignoring them keeps the fake from over-matching. */
function matchesWhere<T extends Record<string, unknown>>(row: T, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object") return true;
    return row[key] === value;
  });
}

export interface OrgTable<T extends Record<string, unknown>> {
  rows: () => T[];
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
}

/**
 * A faithful in-memory Prisma-model fake that honors the scalar `where` filter
 * (notably `organizationId`). Used as `app.prisma.<model>` so the swept routes
 * exercise their real WHERE clauses against a two-org dataset.
 */
export function orgTable<T extends Record<string, unknown>>(seed: T[]): OrgTable<T> {
  let store: T[] = seed.map((r) => ({ ...r }));
  return {
    rows: () => store,
    findMany: vi.fn(async (args?: { where?: Where }) =>
      store.filter((r) => matchesWhere(r, args?.where)),
    ),
    findFirst: vi.fn(
      async (args?: { where?: Where }) => store.find((r) => matchesWhere(r, args?.where)) ?? null,
    ),
    findUnique: vi.fn(
      async (args: { where: Where }) => store.find((r) => matchesWhere(r, args.where)) ?? null,
    ),
    count: vi.fn(
      async (args?: { where?: Where }) => store.filter((r) => matchesWhere(r, args?.where)).length,
    ),
    create: vi.fn(async (args: { data: T }) => {
      const row = { ...args.data };
      store.push(row);
      return row;
    }),
    update: vi.fn(async (args: { where: Where; data: Partial<T> }) => {
      const row = store.find((r) => matchesWhere(r, args.where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, args.data);
      return row;
    }),
    updateMany: vi.fn(async (args: { where?: Where; data: Partial<T> }) => {
      const matched = store.filter((r) => matchesWhere(r, args.where));
      for (const row of matched) Object.assign(row, args.data);
      return { count: matched.length };
    }),
    delete: vi.fn(async (args: { where: Where }) => {
      const row = store.find((r) => matchesWhere(r, args.where));
      if (!row) throw new Error("Record not found");
      store = store.filter((r) => r !== row);
      return row;
    }),
    deleteMany: vi.fn(async (args?: { where?: Where }) => {
      const before = store.length;
      store = store.filter((r) => !matchesWhere(r, args?.where));
      return { count: before - store.length };
    }),
  };
}
