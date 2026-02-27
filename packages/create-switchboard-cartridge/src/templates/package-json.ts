import type { TemplateContext } from "../generator.js";

export function packageJsonTemplate(ctx: TemplateContext): string {
  const pkg = {
    name: `@switchboard-cartridges/${ctx.name}`,
    version: "0.1.0",
    description: ctx.description,
    author: ctx.author,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    scripts: {
      build: "tsc",
      typecheck: "tsc --noEmit",
      test: "vitest run",
      clean: "rm -rf dist",
    },
    dependencies: {
      "@switchboard/cartridge-sdk": "workspace:*",
      "@switchboard/schemas": "workspace:*",
    },
    devDependencies: {
      typescript: "^5.7.0",
      vitest: "^2.1.0",
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}
