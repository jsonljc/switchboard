import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The shell script is the actual unit under test. We invoke it via bash and
// inspect exit codes + filesystem state, mirroring the pattern in
// check-prisma-drift.test.ts.

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCRIPT_ABS = join(REPO_ROOT, "scripts/archive-superpowers-docs.sh");
const SCRIPT_REL = "scripts/archive-superpowers-docs.sh";

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "archive-sp-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  mkdirSync(join(dir, "docs/superpowers/specs/archive"), { recursive: true });
  mkdirSync(join(dir, "docs/superpowers/plans/archive"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  const target = join(dir, SCRIPT_REL);
  copyFileSync(SCRIPT_ABS, target);
  chmodSync(target, 0o755);

  return dir;
}

function commitAll(cwd: string, msg: string) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

let tmpRepos: string[] = [];
beforeEach(() => {
  tmpRepos = [];
});
afterEach(() => {
  for (const d of tmpRepos) rmSync(d, { recursive: true, force: true });
});

function makeRepo(): string {
  const d = setupRepo();
  tmpRepos.push(d);
  return d;
}

describe("archive-superpowers-docs.sh — help output", () => {
  it("--help exits 0 and does not leak shell directives or shebang", () => {
    const result = spawnSync("bash", [SCRIPT_ABS, "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Archive superpowers specs and plans");
    expect(result.stdout).toContain("--dry-run");
    // Regression for the sed range overshoot caught in PR #609 review.
    expect(result.stdout).not.toMatch(/set -euo pipefail/);
    expect(result.stdout).not.toMatch(/^#!/m);
  });
});

describe("archive-superpowers-docs.sh — cutoff & dry-run", () => {
  it("dry-run lists files older than 2 days and skips newer ones", () => {
    const dir = makeRepo();
    const oldDate = "2020-01-01";
    const today = isoDate(0);
    writeFileSync(join(dir, `docs/superpowers/specs/${oldDate}-old.md`), "old\n");
    writeFileSync(join(dir, `docs/superpowers/specs/${today}-today.md`), "today\n");
    commitAll(dir, "init");

    const result = spawnSync("bash", [SCRIPT_REL, "--dry-run"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`would move docs/superpowers/specs/${oldDate}-old.md`);
    expect(result.stdout).not.toContain(`${today}-today.md`);
    // Dry-run must not move anything.
    expect(existsSync(join(dir, `docs/superpowers/specs/${oldDate}-old.md`))).toBe(true);
    expect(existsSync(join(dir, `docs/superpowers/specs/archive/${oldDate}-old.md`))).toBe(false);
  });

  it("--days 0 archives any file with a past date prefix", () => {
    const dir = makeRepo();
    const yesterday = isoDate(-1);
    writeFileSync(join(dir, `docs/superpowers/specs/${yesterday}-recent.md`), "recent\n");
    commitAll(dir, "init");

    const defaultRun = spawnSync("bash", [SCRIPT_REL, "--dry-run"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(defaultRun.stdout).toMatch(/nothing to archive/);

    const zeroDays = spawnSync("bash", [SCRIPT_REL, "--dry-run", "--days", "0"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(zeroDays.stdout).toContain(`would move docs/superpowers/specs/${yesterday}-recent.md`);
  });
});

describe("archive-superpowers-docs.sh — safety guards", () => {
  it("refuses on a non-main branch in default mode (exit 0, no moves)", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "README.md"), "x\n");
    commitAll(dir, "init");
    git(dir, ["checkout", "-q", "-b", "feature/x"]);
    writeFileSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"), "old\n");
    commitAll(dir, "old");

    const result = spawnSync("bash", [SCRIPT_REL], { cwd: dir, encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Cannot commit \(branch=feature\/x/);
    expect(existsSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/superpowers/specs/archive/2020-01-01-old.md"))).toBe(false);
  });

  it("refuses (exit 3) when docs/superpowers/{specs,plans} already has uncommitted changes", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"), "old\n");
    commitAll(dir, "init");
    writeFileSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"), "edited\n");

    const result = spawnSync("bash", [SCRIPT_REL, "--no-commit"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("uncommitted changes");
  });

  it("refuses (exit 3) during a rebase in progress", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "README.md"), "x\n");
    commitAll(dir, "init");
    // Forge a rebase-merge marker — the script only checks for its presence.
    mkdirSync(join(dir, ".git/rebase-merge"), { recursive: true });

    const result = spawnSync("bash", [SCRIPT_REL, "--dry-run"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("mid-operation");
  });

  it("rejects unknown arguments (exit 2)", () => {
    const dir = makeRepo();
    const result = spawnSync("bash", [SCRIPT_REL, "--bogus"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown argument");
  });
});

describe("archive-superpowers-docs.sh — moves & commit", () => {
  it("--no-commit moves files into the sibling archive/ and stages them", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"), "old\n");
    writeFileSync(join(dir, "docs/superpowers/plans/2020-02-02-old.md"), "old plan\n");
    commitAll(dir, "init");

    const result = spawnSync("bash", [SCRIPT_REL, "--no-commit"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("archived 2 file(s)");
    expect(existsSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"))).toBe(false);
    expect(existsSync(join(dir, "docs/superpowers/specs/archive/2020-01-01-old.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/superpowers/plans/archive/2020-02-02-old.md"))).toBe(true);

    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: dir,
      encoding: "utf-8",
    });
    // Renames are staged but not yet committed.
    expect(status).toMatch(/^R/m);
  });

  it("default mode commits when on main with a clean tree", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"), "old\n");
    commitAll(dir, "init");

    const result = spawnSync("bash", [SCRIPT_REL], { cwd: dir, encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("committed archive of 1 file(s) on main");

    const log = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf-8" });
    expect(log).toMatch(/auto-archive superpowers specs\/plans/);
    expect(existsSync(join(dir, "docs/superpowers/specs/archive/2020-01-01-old.md"))).toBe(true);
  });

  it("skips files whose destination already exists (idempotency)", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"), "old\n");
    writeFileSync(join(dir, "docs/superpowers/specs/archive/2020-01-01-old.md"), "already there\n");
    commitAll(dir, "init");

    const result = spawnSync("bash", [SCRIPT_REL, "--no-commit"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("destination exists");
    // Source untouched.
    expect(existsSync(join(dir, "docs/superpowers/specs/2020-01-01-old.md"))).toBe(true);
  });
});
