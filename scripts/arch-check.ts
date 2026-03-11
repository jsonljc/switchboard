#!/usr/bin/env npx tsx
/**
 * Architecture Health Check Script
 *
 * Generates a report covering:
 * - Files over 400 lines (god module candidates)
 * - Packages with fewer than 3 test files
 * - `as any` usage count per package
 * - Package file counts (monolith detection)
 * - Dockerfile vs workspace cartridge comparison
 */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const WARN_LINES = 400;
const ERROR_LINES = 600;

interface FileInfo {
  path: string;
  lines: number;
}

interface PackageInfo {
  name: string;
  srcFiles: number;
  testFiles: number;
  anyCount: number;
  longFiles: FileInfo[];
}

// ─── Helpers ───

function walkDir(dir: string, ext: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") {
        continue;
      }
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function countAny(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    const matches = content.match(/\bas\s+any\b/g);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

function getPackageDirs(): string[] {
  const dirs: string[] = [];
  for (const base of ["packages", "cartridges", "apps"]) {
    const baseDir = join(ROOT, base);
    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(join(baseDir, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }
  return dirs;
}

function analyzePackage(pkgDir: string): PackageInfo {
  const srcDir = join(pkgDir, "src");
  const allTs = walkDir(srcDir, ".ts");
  const srcFiles = allTs.filter((f) => !f.includes(".test.") && !f.includes(".spec."));
  const testFiles = allTs.filter((f) => f.includes(".test.") || f.includes(".spec."));

  let anyCount = 0;
  const longFiles: FileInfo[] = [];

  for (const file of srcFiles) {
    anyCount += countAny(file);
    const lines = countLines(file);
    if (lines > WARN_LINES) {
      longFiles.push({ path: relative(ROOT, file), lines });
    }
  }

  return {
    name: relative(ROOT, pkgDir),
    srcFiles: srcFiles.length,
    testFiles: testFiles.length,
    anyCount,
    longFiles,
  };
}

// ─── Dockerfile Check ───

function checkDockerfile(): string[] {
  const issues: string[] = [];
  try {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf-8");
    const cartridgesDir = join(ROOT, "cartridges");
    const cartridges = readdirSync(cartridgesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const cartridge of cartridges) {
      if (!dockerfile.includes(`cartridges/${cartridge}/`)) {
        issues.push(`Cartridge "${cartridge}" is missing from Dockerfile`);
      }
    }
  } catch {
    issues.push("Could not read Dockerfile");
  }
  return issues;
}

// ─── Dependency-Cruiser Check ───

function runDepCruise(): string {
  try {
    const result = execSync(
      "npx depcruise --config .dependency-cruiser.cjs packages/ cartridges/ apps/ 2>&1",
      { cwd: ROOT, encoding: "utf-8", timeout: 30000 },
    );
    return result;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return err.stdout || err.stderr || "dependency-cruiser not available";
  }
}

// ─── Main Report ───

function main(): void {
  const packages = getPackageDirs().map(analyzePackage);

  console.error("\n╔══════════════════════════════════════════════════╗");
  console.error("║        ARCHITECTURE HEALTH CHECK REPORT         ║");
  console.error("╚══════════════════════════════════════════════════╝\n");

  // 1. Long files
  const allLongFiles = packages.flatMap((p) => p.longFiles);
  if (allLongFiles.length > 0) {
    console.error(`⚠  FILES OVER ${WARN_LINES} LINES (god module candidates):`);
    for (const f of allLongFiles.sort((a, b) => b.lines - a.lines)) {
      const level = f.lines > ERROR_LINES ? "🔴" : "🟡";
      console.error(`   ${level} ${f.path}: ${f.lines} lines`);
    }
  } else {
    console.error(`✅ No files over ${WARN_LINES} lines`);
  }
  console.error("");

  // 2. Test coverage gaps
  const lowTestPkgs = packages.filter((p) => p.srcFiles > 0 && p.testFiles < 3);
  if (lowTestPkgs.length > 0) {
    console.error("⚠  PACKAGES WITH <3 TEST FILES:");
    for (const p of lowTestPkgs) {
      const level = p.testFiles === 0 ? "🔴" : "🟡";
      console.error(`   ${level} ${p.name}: ${p.testFiles} test files (${p.srcFiles} source files)`);
    }
  } else {
    console.error("✅ All packages have adequate test coverage");
  }
  console.error("");

  // 3. `as any` usage
  const anyPkgs = packages.filter((p) => p.anyCount > 0);
  if (anyPkgs.length > 0) {
    console.error("⚠  `as any` USAGE BY PACKAGE:");
    for (const p of anyPkgs.sort((a, b) => b.anyCount - a.anyCount)) {
      console.error(`   🟡 ${p.name}: ${p.anyCount} occurrences`);
    }
  } else {
    console.error("✅ No `as any` usage found");
  }
  console.error("");

  // 4. Package sizes
  console.error("📊 PACKAGE FILE COUNTS:");
  for (const p of packages.sort((a, b) => b.srcFiles - a.srcFiles)) {
    if (p.srcFiles === 0) continue;
    const level = p.srcFiles > 50 ? "🔴" : p.srcFiles > 30 ? "🟡" : "  ";
    console.error(`   ${level} ${p.name}: ${p.srcFiles} source files, ${p.testFiles} test files`);
  }
  console.error("");

  // 5. Dockerfile check
  const dockerIssues = checkDockerfile();
  if (dockerIssues.length > 0) {
    console.error("⚠  DOCKERFILE ISSUES:");
    for (const issue of dockerIssues) {
      console.error(`   🔴 ${issue}`);
    }
  } else {
    console.error("✅ Dockerfile includes all cartridges");
  }
  console.error("");

  // 6. Dependency-cruiser
  console.error("🔍 DEPENDENCY BOUNDARY CHECK:");
  const depResult = runDepCruise();
  if (depResult.includes("no dependency violations found")) {
    console.error("   ✅ No dependency violations");
  } else {
    console.error(depResult);
  }
  console.error("");

  // Summary
  const totalIssues = allLongFiles.length + lowTestPkgs.length + anyPkgs.reduce((s, p) => s + p.anyCount, 0) + dockerIssues.length;
  if (totalIssues === 0) {
    console.error("🎉 Architecture health: EXCELLENT — no issues found");
  } else {
    console.error(`📋 Architecture health: ${totalIssues} issue(s) found — review above`);
  }
  console.error("");
}

main();
