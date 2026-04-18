/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ─── schemas is a leaf package: no @switchboard/* imports ───
    {
      name: "schemas-no-internal-deps",
      severity: "error",
      comment: "schemas is a leaf package and cannot import any @switchboard/* package.",
      from: { path: "^packages/schemas/src" },
      to: { path: "^(packages|apps)/" },
    },

    // ─── cartridge-sdk may only import schemas ───
    {
      name: "cartridge-sdk-only-schemas",
      severity: "error",
      comment: "cartridge-sdk may only import @switchboard/schemas.",
      from: { path: "^packages/cartridge-sdk/src" },
      to: {
        path: "^(packages/(core|db)|apps)/",
      },
    },

    // ─── creative-pipeline may only import schemas ───
    {
      name: "creative-pipeline-only-schemas",
      severity: "error",
      comment: "creative-pipeline may only import @switchboard/schemas.",
      from: { path: "^packages/creative-pipeline/src" },
      to: {
        path: "^(packages/(core|db|cartridge-sdk|ad-optimizer)|apps)/",
      },
    },

    // ─── ad-optimizer may only import schemas ───
    {
      name: "ad-optimizer-only-schemas",
      severity: "error",
      comment: "ad-optimizer may only import @switchboard/schemas.",
      from: { path: "^packages/ad-optimizer/src" },
      to: {
        path: "^(packages/(core|db|cartridge-sdk|creative-pipeline)|apps)/",
      },
    },

    // ─── core may only import schemas, cartridge-sdk, and ad-optimizer ───
    {
      name: "core-allowed-deps",
      severity: "error",
      comment:
        "core may import schemas, cartridge-sdk, and ad-optimizer (for skill-runtime tools).",
      from: { path: "^packages/core/src" },
      to: {
        path: "^(packages/(db|creative-pipeline)|apps)/",
      },
    },

    // ─── db may only import schemas and core ───
    {
      name: "db-allowed-deps",
      severity: "error",
      comment: "db may only import @switchboard/schemas and @switchboard/core.",
      from: { path: "^packages/db/src" },
      to: {
        path: "^(packages/cartridge-sdk|apps)/",
      },
    },

    // ─── no circular dependencies ───
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies between packages are forbidden.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "dist", "coverage"],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    exclude: {
      path: [
        "\\.test\\.ts$",
        "\\.spec\\.ts$",
        "__tests__",
        "__mocks__",
        "\\.d\\.ts$",
      ],
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".js", ".json"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)",
      },
      text: {
        highlightFocused: true,
      },
    },
  },
};
