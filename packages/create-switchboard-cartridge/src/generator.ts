import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CartridgeAnswers } from "./prompts.js";
import { packageJsonTemplate } from "./templates/package-json.js";
import { tsconfigJsonTemplate } from "./templates/tsconfig-json.js";
import { indexTsTemplate } from "./templates/index-ts.js";
import { manifestTsTemplate } from "./templates/manifest-ts.js";
import { bootstrapTsTemplate } from "./templates/bootstrap-ts.js";
import { policiesTsTemplate } from "./templates/policies-ts.js";
import { guardrailsTsTemplate } from "./templates/guardrails-ts.js";
import { riskTsTemplate } from "./templates/risk-ts.js";
import { providerTsTemplate } from "./templates/provider-ts.js";
import { testTsTemplate } from "./templates/test-ts.js";
import { readmeMdTemplate } from "./templates/readme-md.js";

function toPascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function toConstCase(kebab: string): string {
  return kebab.replace(/-/g, "_").toUpperCase();
}

export interface TemplateContext {
  name: string;
  displayName: string;
  description: string;
  actionType: string;
  actionName: string;
  connectionId: string;
  author: string;
  pascalName: string;
  constName: string;
}

function buildContext(answers: CartridgeAnswers): TemplateContext {
  return {
    ...answers,
    pascalName: toPascalCase(answers.name),
    constName: toConstCase(answers.name),
  };
}

async function writeFileWithDirs(filePath: string, content: string): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export async function generateProject(answers: CartridgeAnswers): Promise<void> {
  const ctx = buildContext(answers);
  const root = join(process.cwd(), answers.name);

  const files: Array<[string, string]> = [
    [join(root, "package.json"), packageJsonTemplate(ctx)],
    [join(root, "tsconfig.json"), tsconfigJsonTemplate()],
    [join(root, "README.md"), readmeMdTemplate(ctx)],
    [join(root, "src", "index.ts"), indexTsTemplate(ctx)],
    [join(root, "src", "manifest.ts"), manifestTsTemplate(ctx)],
    [join(root, "src", "bootstrap.ts"), bootstrapTsTemplate(ctx)],
    [join(root, "src", "providers", `${answers.connectionId}.ts`), providerTsTemplate(ctx)],
    [join(root, "src", "actions", "index.ts"), "export {};\n"],
    [join(root, "src", "defaults", "policies.ts"), policiesTsTemplate(ctx)],
    [join(root, "src", "defaults", "guardrails.ts"), guardrailsTsTemplate(ctx)],
    [join(root, "src", "risk", "categories.ts"), riskTsTemplate(ctx)],
    [join(root, "src", "__tests__", `${answers.name}.test.ts`), testTsTemplate(ctx)],
  ];

  for (const [filePath, content] of files) {
    await writeFileWithDirs(filePath, content);
  }
}
