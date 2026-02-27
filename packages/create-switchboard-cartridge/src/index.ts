#!/usr/bin/env node

import { collectAnswers } from "./prompts.js";
import { generateProject } from "./generator.js";

async function main(): Promise<void> {
  console.log("\n🔧 Create Switchboard Cartridge\n");

  const answers = await collectAnswers();
  if (!answers) {
    console.log("\nAborted.");
    process.exit(1);
  }

  await generateProject(answers);

  console.log(`\n✅ Cartridge scaffolded at ./${answers.name}/`);
  console.log("\nNext steps:");
  console.log(`  cd ${answers.name}`);
  console.log("  npm install");
  console.log("  npm test");
  console.log("");
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
