import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../index.js";

describe("generated Prisma client surface", () => {
  it("includes dashboard and marketplace fields used by the dashboard app", () => {
    const client = createPrismaClient();
    expect("dashboardUser" in client).toBe(true);
  });
});
