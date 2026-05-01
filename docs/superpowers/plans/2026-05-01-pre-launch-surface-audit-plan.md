# Pre-Launch Surface Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the pre-launch surface audit defined in [`docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md`](../specs/2026-05-01-pre-launch-surface-audit-design.md), producing 7 findings docs, a triage index with a structured launch-blocker queue, and a re-audit gate runbook.

**Architecture:** Four phases. **Phase A** builds shared tooling with TDD (validation script, Lighthouse / axe runners, templates, audit-dir scaffolding). **Phase B** runs 7 surface audits sequentially in the locked spec order — each produces a findings doc, calibrated severities, and committed artifacts. **Phase C** runs cross-surface triage with bidirectional re-calibration and structured ship-with entries. **Phase D** documents the pre-launch re-audit gate as a runbook for launch time.

**Tech Stack:** Node 18+, pnpm 9 + Turborepo, TypeScript ESM (`.js` extensions on relative imports), `tsx` for direct TS execution (existing convention — see `scripts/arch-check.ts`), Vitest for the validation-script tests (root vitest config picks up `scripts/__tests__/*.test.ts`), Lighthouse CLI via `pnpm dlx lighthouse`, axe-core via `@axe-core/cli` or DevTools extension, dashboard dev server on `localhost:3002`, API on `localhost:3000`.

---

## Spec reference

The spec is the source of truth for: surfaces in scope, depth tiers, dimensions per surface, finding template, severity scheme, evidence minimums, ship-with hard prohibitions, calibration ritual, validation rules, Lighthouse/axe protocol, resume protocol, stale-finding rule, re-audit gate.

**Read the spec before each surface task.** Calibration depends on it.

## Branching strategy

- **Phase A (tooling)** lands on `main` as one focused PR. The new script + tests + package.json updates are one cohesive change.
- **Each surface session (Phase B)** creates a short-lived branch off `main`: `audit/<NN>-<surface-slug>` (e.g., `audit/01-dashboard-core`). PR the findings doc + progress + artifacts when the surface is closed. Merge to `main` before starting the next surface.
- **Phase C (triage)** is its own branch + PR.
- **Phase D (runbook)** can ride along with Phase C or be its own small PR.

This matches the `CLAUDE.md` "specs and plans land on main via focused PRs" doctrine while keeping the audit feedback loop tight.

## File structure

| File / Path | What | Status |
|-------------|------|--------|
| `scripts/audit-validate-findings.ts` | Validates a findings doc against §6 / §13.2: required fields, evidence minimum, severity / dimension / status enums, Discovered-at SHA. Exits 1 on validation failure. | Create |
| `scripts/__tests__/audit-validate-findings.test.ts` | Vitest tests for the validation script — valid doc passes; missing field, weak evidence, bad enum, bad SHA each fail. | Create |
| `scripts/audit-run-lighthouse.sh` | Wraps `pnpm dlx lighthouse` per spec §13.3: builds production, starts the server, runs desktop + mobile profiles, writes JSON + meta.txt to `artifacts/<NN-surface>/`. | Create |
| `scripts/audit-run-axe.sh` | Wraps `@axe-core/cli` per §13.3: runs against the production build, writes JSON + meta.txt. | Create |
| `package.json` | Add `audit:validate`, `audit:lighthouse`, `audit:axe` scripts. | Modify |
| `docs/audits/2026-05-01-pre-launch-surface/_templates/findings.template.md` | Findings-doc skeleton: front-matter (Surface, Discovered-at, dimensions in scope), per-dimension `Checked: <X> — no findings` placeholders, finding-block template. | Create |
| `docs/audits/2026-05-01-pre-launch-surface/_templates/progress.template.md` | Per-surface progress checklist for the resume protocol (§13.1). | Create |
| `docs/audits/2026-05-01-pre-launch-surface/index.md` | Top-level triage doc — starts as scope summary + per-severity counters; populated during Phase C. | Create |
| `docs/audits/2026-05-01-pre-launch-surface/0[1-7]-<surface>-findings.md` | Findings doc per surface. | Create (one per Phase B task) |
| `docs/audits/2026-05-01-pre-launch-surface/0[1-7]-<surface>-progress.md` | Resume tracker per surface. | Create + delete-on-close (§13.1) |
| `docs/audits/2026-05-01-pre-launch-surface/artifacts/0[1-7]-<surface>/` | Lighthouse JSON, axe JSON, screenshots, `meta.txt`. | Create per surface |
| `docs/audits/2026-05-01-pre-launch-surface/runbook-re-audit-gate.md` | Pre-launch re-audit procedure (§13.7). | Create in Task 16 |

## Resume protocol (read first if resuming a partial session)

If a previous session was interrupted mid-task:

1. Find the latest surface's `*-progress.md` under `docs/audits/2026-05-01-pre-launch-surface/`.
2. Identify the last unchecked dimension. That's where this session resumes.
3. Read the surface's existing `*-findings.md` to load context into your head before continuing.
4. Continue from the resume point. Do not re-run completed dimensions unless the spec's stale-finding rule applies (§13.6).

---

# Phase A — Tooling and templates

## Task 1: Pre-flight

**Files:** none modified.

- [ ] **Step 1:** Confirm branch context.

  ```bash
  cd /Users/jasonli/switchboard
  git branch --show-current
  git status --short
  ```

  Expected: on a fresh branch off `main` (e.g., `audit/tooling`). Tree clean. If not, create the branch first:

  ```bash
  git fetch origin main
  git checkout -b audit/tooling origin/main
  ```

- [ ] **Step 2:** Verify baseline tests pass.

  ```bash
  pnpm test
  ```

  Expected: all green. If failing, run `pnpm reset` first per `CLAUDE.md`, then re-run.

- [ ] **Step 3:** Verify typecheck passes.

  ```bash
  pnpm typecheck
  ```

  Expected: PASS.

---

## Task 2: Audit directory scaffolding

**Files:**
- Create: `docs/audits/2026-05-01-pre-launch-surface/` (directory)
- Create: `docs/audits/2026-05-01-pre-launch-surface/_templates/` (directory)
- Create: `docs/audits/2026-05-01-pre-launch-surface/.gitkeep` (placeholder so the dir exists)

- [ ] **Step 1:** Create the directory and a `.gitkeep` so the empty dir lands in git.

  ```bash
  mkdir -p docs/audits/2026-05-01-pre-launch-surface/_templates
  mkdir -p docs/audits/2026-05-01-pre-launch-surface/artifacts
  touch docs/audits/2026-05-01-pre-launch-surface/.gitkeep
  ```

- [ ] **Step 2:** Verify dirs exist.

  ```bash
  ls docs/audits/2026-05-01-pre-launch-surface/
  ```

  Expected: `_templates`, `artifacts`, `.gitkeep`.

---

## Task 3: Findings doc + progress templates

**Files:**
- Create: `docs/audits/2026-05-01-pre-launch-surface/_templates/findings.template.md`
- Create: `docs/audits/2026-05-01-pre-launch-surface/_templates/progress.template.md`

- [ ] **Step 1:** Write the findings template.

  Write `docs/audits/2026-05-01-pre-launch-surface/_templates/findings.template.md`:

  ```markdown
  ---
  surface: <NN>-<surface-slug>
  discovered_at: <commit SHA at session start>
  dimensions_in_scope: [A, B, C, D, E, F, G, H, I-light, J]
  session_started: <YYYY-MM-DD>
  session_closed: <YYYY-MM-DD or "open">
  ---

  # <Surface name> — Findings

  ## Coverage

  Checked: A — <no findings | see findings below>
  Checked: B — <...>
  Checked: C — <...>
  <one Checked: line per in-scope dimension; never silent>

  ## Calibration precedents (this surface)

  <list any severity calls confirmed/changed during the calibration ritual>

  ---

  ## <PREFIX>-01

  - **Surface:** <route>
  - **Sub-surface:** <zone or "global">
  - **Dimension:** <primary>[, <secondary>]
  - **Severity:** <Launch-blocker | High | Medium | Low | Defer>
  - **Affects:** <all users | new users | returning users | tenant admins | operators only | other:____>
  - **Status:** Open
  - **Discovered-at:** <commit SHA>
  - **Effort:** <S | M | L>

  **What:**
  <1–3 sentences>

  **Evidence:**
  - File: <path:line>
  - Screenshot: <artifacts/...>
  - Repro: <numbered steps>

  **Fix:**
  <1–2 sentences — direction, not implementation>

  ---
  ```

- [ ] **Step 2:** Write the progress template.

  Write `docs/audits/2026-05-01-pre-launch-surface/_templates/progress.template.md`:

  ```markdown
  # <Surface name> — Session Progress

  > Resume protocol per spec §13.1. Delete this file when the surface is closed.

  **Session SHA at start:** <commit SHA>
  **Session date:** <YYYY-MM-DD>
  **Tier:** <Deep | Standard | Light>

  ## Pre-flight

  - [ ] Spec re-read for this surface (§4 row, §5 dimension list)
  - [ ] Routes enumerated (`find apps/dashboard/src/app -name page.tsx | grep -E "<surface routes>"`)
  - [ ] Dev server up: `pnpm --filter @switchboard/dashboard dev` (port 3002)
  - [ ] API up if needed: `pnpm --filter @switchboard/api dev` (port 3000)

  ## Dimensions

  - [ ] A — Visual
  - [ ] B — UX flow
  - [ ] C — Copy
  - [ ] D — State
  - [ ] E — Responsive
  - [ ] F — A11y
  - [ ] G — Performance
  - [ ] H — Contract
  - [ ] I-light — Auth
  - [ ] J — Notifications-specific (only surface 6)

  > Tick only dimensions that are in scope per the spec for this surface. Lines outside scope can be deleted.

  ## Closeout

  - [ ] Calibration ritual run with user (§13.8)
  - [ ] Validation passes: `pnpm audit:validate <findings file>`
  - [ ] Artifacts committed under `artifacts/<NN-surface>/`
  - [ ] Findings doc front-matter `session_closed` set
  - [ ] PR opened
  ```

- [ ] **Step 3:** Verify both templates exist.

  ```bash
  ls docs/audits/2026-05-01-pre-launch-surface/_templates/
  ```

  Expected: `findings.template.md`, `progress.template.md`.

---

## Task 4: Validation script (TDD)

**Files:**
- Create: `scripts/audit-validate-findings.ts`
- Create: `scripts/__tests__/audit-validate-findings.test.ts`

The validation script parses a findings markdown file. Each finding is a `## <PREFIX>-NN` section followed by a labelled list (Surface, Sub-surface, Dimension, Severity, Affects, Status, Discovered-at, Effort) and prose blocks (What, Evidence, Fix).

Validation rules per spec §13.2:

1. Every finding has all required fields populated (no blank values, no `<placeholder>` text).
2. Every Launch-blocker finding has ≥2 of {File, Screenshot, Repro} in its Evidence block; at least one is File or Repro.
3. Severity ∈ {Launch-blocker, High, Medium, Low, Defer}.
4. Dimension(s) ∈ {A, B, C, D, E, F, G, H, I, I-light, J}.
5. Status ∈ {Open, Accepted (ship-with), Fixed (PR #__), False positive}.
6. Discovered-at matches `git rev-parse --verify <SHA>` (exists in the repo).

- [ ] **Step 1:** Write the failing test.

  Create `scripts/__tests__/audit-validate-findings.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { validateFindings } from "../audit-validate-findings.js";

  const validDoc = `---
  surface: 01-dashboard-core
  discovered_at: HEAD
  ---

  # Dashboard core — Findings

  ## Coverage
  Checked: A — see findings below

  ## DC-01

  - **Surface:** /console
  - **Sub-surface:** queue zone
  - **Dimension:** D
  - **Severity:** High
  - **Affects:** all users
  - **Status:** Open
  - **Discovered-at:** HEAD
  - **Effort:** S

  **What:**
  Empty queue renders nothing.

  **Evidence:**
  - File: apps/dashboard/src/components/console/console-view.tsx:142
  - Repro: Visit /console with no escalations.

  **Fix:**
  Render EmptyState component.
  `;

  describe("validateFindings", () => {
    it("accepts a valid findings doc", () => {
      const result = validateFindings(validDoc);
      expect(result.errors).toEqual([]);
    });

    it("rejects a finding missing a required field", () => {
      const bad = validDoc.replace("- **Severity:** High\n", "");
      const result = validateFindings(bad);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/DC-01.*Severity/)])
      );
    });

    it("rejects a Launch-blocker with only one evidence type", () => {
      const bad = validDoc
        .replace("- **Severity:** High", "- **Severity:** Launch-blocker")
        .replace(
          "- File: apps/dashboard/src/components/console/console-view.tsx:142\n- Repro: Visit /console with no escalations.",
          "- Repro: Visit /console with no escalations."
        );
      const result = validateFindings(bad);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/DC-01.*evidence/i)])
      );
    });

    it("rejects an unknown severity", () => {
      const bad = validDoc.replace("- **Severity:** High", "- **Severity:** Critical");
      const result = validateFindings(bad);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/DC-01.*Severity.*Critical/)])
      );
    });

    it("rejects an unknown dimension", () => {
      const bad = validDoc.replace("- **Dimension:** D", "- **Dimension:** Z");
      const result = validateFindings(bad);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/DC-01.*Dimension.*Z/)])
      );
    });

    it("rejects an unknown status", () => {
      const bad = validDoc.replace("- **Status:** Open", "- **Status:** WIP");
      const result = validateFindings(bad);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/DC-01.*Status.*WIP/)])
      );
    });

    it("rejects a placeholder left in", () => {
      const bad = validDoc.replace("queue zone", "<zone>");
      const result = validateFindings(bad);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/DC-01.*placeholder/i)])
      );
    });
  });
  ```

- [ ] **Step 2:** Run the test, watch it fail.

  ```bash
  pnpm vitest run scripts/__tests__/audit-validate-findings.test.ts
  ```

  Expected: FAIL with "Cannot find module '../audit-validate-findings.js'".

- [ ] **Step 3:** Implement the validation script.

  Create `scripts/audit-validate-findings.ts`:

  ```ts
  #!/usr/bin/env npx tsx
  /**
   * Validates a findings markdown file against the rules in
   * docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md §13.2.
   *
   * Usage: tsx scripts/audit-validate-findings.ts <findings.md>
   */
  import { readFileSync } from "node:fs";
  import { execSync } from "node:child_process";

  const SEVERITIES = new Set(["Launch-blocker", "High", "Medium", "Low", "Defer"]);
  const DIMENSIONS = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "I-light", "J"]);
  const STATUS_PATTERNS = [
    /^Open$/,
    /^Accepted \(ship-with\)$/,
    /^Fixed \(PR #\d+\)$/,
    /^False positive \(.+\)$/,
  ];
  const REQUIRED_FIELDS = [
    "Surface",
    "Sub-surface",
    "Dimension",
    "Severity",
    "Affects",
    "Status",
    "Discovered-at",
    "Effort",
  ];
  const PLACEHOLDER_REGEX = /<[^>]*>/;

  interface Finding {
    id: string;
    fields: Record<string, string>;
    evidenceTypes: Set<"File" | "Screenshot" | "Repro">;
    rawBlock: string;
  }

  export interface ValidationResult {
    errors: string[];
  }

  function parseFindings(doc: string): Finding[] {
    const findings: Finding[] = [];
    const blocks = doc.split(/^## (?=[A-Z]{2}-\d+)/m).slice(1);
    for (const block of blocks) {
      const idMatch = block.match(/^([A-Z]{2}-\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      const fields: Record<string, string> = {};
      for (const field of REQUIRED_FIELDS) {
        const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*([^\\n]+)`);
        const m = block.match(re);
        if (m) fields[field] = m[1].trim();
      }
      const evidenceBlock = block.match(/\*\*Evidence:\*\*([\s\S]*?)(?=\n\*\*Fix:\*\*|$)/);
      const evidenceTypes = new Set<"File" | "Screenshot" | "Repro">();
      if (evidenceBlock) {
        if (/^- File:/m.test(evidenceBlock[1])) evidenceTypes.add("File");
        if (/^- Screenshot:/m.test(evidenceBlock[1])) evidenceTypes.add("Screenshot");
        if (/^- Repro:/m.test(evidenceBlock[1])) evidenceTypes.add("Repro");
      }
      findings.push({ id, fields, evidenceTypes, rawBlock: block });
    }
    return findings;
  }

  function shaExists(sha: string): boolean {
    try {
      execSync(`git rev-parse --verify ${sha}^{commit}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  export function validateFindings(doc: string, opts: { checkSha?: boolean } = {}): ValidationResult {
    const errors: string[] = [];
    const findings = parseFindings(doc);
    if (findings.length === 0) {
      // Empty findings docs are valid per spec — surface may have no findings.
      return { errors };
    }
    for (const f of findings) {
      for (const field of REQUIRED_FIELDS) {
        if (!f.fields[field]) {
          errors.push(`${f.id}: missing required field "${field}"`);
          continue;
        }
        if (PLACEHOLDER_REGEX.test(f.fields[field])) {
          errors.push(`${f.id}: placeholder left in field "${field}" (value: ${f.fields[field]})`);
        }
      }
      const sev = f.fields.Severity;
      if (sev && !SEVERITIES.has(sev)) {
        errors.push(`${f.id}: unknown Severity "${sev}"`);
      }
      const dim = f.fields.Dimension;
      if (dim) {
        const codes = dim.split(",").map((s) => s.trim());
        for (const code of codes) {
          if (!DIMENSIONS.has(code)) {
            errors.push(`${f.id}: unknown Dimension "${code}"`);
          }
        }
      }
      const status = f.fields.Status;
      if (status && !STATUS_PATTERNS.some((p) => p.test(status))) {
        errors.push(`${f.id}: unknown Status "${status}"`);
      }
      if (sev === "Launch-blocker") {
        if (f.evidenceTypes.size < 2) {
          errors.push(`${f.id}: Launch-blocker requires ≥2 evidence types (has ${f.evidenceTypes.size})`);
        }
        if (!f.evidenceTypes.has("File") && !f.evidenceTypes.has("Repro")) {
          errors.push(`${f.id}: Launch-blocker evidence must include File or Repro`);
        }
      } else if (["High", "Medium"].includes(sev ?? "")) {
        if (f.evidenceTypes.size < 1) {
          errors.push(`${f.id}: ${sev} severity requires ≥1 evidence type`);
        }
      }
      if (opts.checkSha && f.fields["Discovered-at"]) {
        const sha = f.fields["Discovered-at"];
        if (sha !== "HEAD" && !shaExists(sha)) {
          errors.push(`${f.id}: Discovered-at SHA "${sha}" does not exist in repo`);
        }
      }
    }
    return { errors };
  }

  // CLI entry point — only runs when this file is the script being executed,
  // not when imported by tests.
  const isCli = import.meta.url === `file://${process.argv[1]}`;
  if (isCli) {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      console.error("Usage: tsx scripts/audit-validate-findings.ts <findings.md>");
      process.exit(2);
    }
    const file = argv[0];
    const doc = readFileSync(file, "utf8");
    const result = validateFindings(doc, { checkSha: true });
    if (result.errors.length > 0) {
      console.error(`Validation failed for ${file}:`);
      for (const e of result.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.warn(`OK: ${file} (${doc.match(/^## [A-Z]{2}-\d+/gm)?.length ?? 0} findings)`);
  }
  ```

- [ ] **Step 4:** Run tests, watch them pass.

  ```bash
  pnpm vitest run scripts/__tests__/audit-validate-findings.test.ts
  ```

  Expected: all 7 tests PASS.

- [ ] **Step 5:** Sanity-check the CLI runs.

  ```bash
  npx tsx scripts/audit-validate-findings.ts docs/audits/2026-05-01-pre-launch-surface/_templates/findings.template.md
  ```

  Expected: prints `OK: ... (0 findings)` and exits 0 (the template has no `## XX-NN` blocks, only `## <PREFIX>-01` which doesn't match the parser's regex `[A-Z]{2}-\d+`).

- [ ] **Step 6:** Commit.

  ```bash
  git add scripts/audit-validate-findings.ts scripts/__tests__/audit-validate-findings.test.ts
  git commit -m "feat(audit): findings-doc validation script"
  ```

---

## Task 5: Lighthouse runner script

**Files:**
- Create: `scripts/audit-run-lighthouse.sh`

The runner builds dashboard production, starts it, runs Lighthouse desktop + mobile, kills the server, writes JSON + meta.txt.

- [ ] **Step 1:** Write the script.

  Create `scripts/audit-run-lighthouse.sh`:

  ```bash
  #!/usr/bin/env bash
  # audit-run-lighthouse.sh <route> <output-dir>
  # Runs Lighthouse against a production build of @switchboard/dashboard.
  # Writes lighthouse-desktop.json, lighthouse-mobile.json, meta.txt to <output-dir>.
  set -euo pipefail

  if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <route-path> <output-dir>" >&2
    echo "Example: $0 /console docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core" >&2
    exit 2
  fi

  ROUTE="$1"
  OUT_DIR="$2"
  PORT="${PORT:-3002}"
  URL="http://localhost:${PORT}${ROUTE}"
  SHA="$(git rev-parse HEAD)"
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$OUT_DIR"

  echo "Building dashboard (production)..."
  pnpm --filter @switchboard/dashboard build

  echo "Starting dashboard on port ${PORT}..."
  pnpm --filter @switchboard/dashboard start --port "${PORT}" &
  SERVER_PID=$!
  trap "kill ${SERVER_PID} 2>/dev/null || true" EXIT

  # Wait for server to come up.
  for i in {1..30}; do
    if curl -sf "http://localhost:${PORT}" > /dev/null; then break; fi
    sleep 1
  done

  echo "Running Lighthouse desktop..."
  pnpm dlx lighthouse "$URL" \
    --preset=desktop \
    --output=json \
    --output-path="${OUT_DIR}/lighthouse-desktop.json" \
    --chrome-flags="--headless"

  echo "Running Lighthouse mobile..."
  pnpm dlx lighthouse "$URL" \
    --output=json \
    --output-path="${OUT_DIR}/lighthouse-mobile.json" \
    --chrome-flags="--headless"

  cat > "${OUT_DIR}/meta.txt" <<EOF
  command:    audit-run-lighthouse.sh ${ROUTE} ${OUT_DIR}
  url:        ${URL}
  build_sha:  ${SHA}
  started_at: ${STARTED_AT}
  finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  os:         $(uname -a)
  EOF

  echo "Done. Artifacts in ${OUT_DIR}"
  ```

- [ ] **Step 2:** Make it executable.

  ```bash
  chmod +x scripts/audit-run-lighthouse.sh
  ```

- [ ] **Step 3:** Verify it shows usage when called with no args.

  ```bash
  bash scripts/audit-run-lighthouse.sh
  ```

  Expected: prints usage, exits 2.

- [ ] **Step 4:** Commit.

  ```bash
  git add scripts/audit-run-lighthouse.sh
  git commit -m "feat(audit): Lighthouse runner script"
  ```

---

## Task 6: axe runner script

**Files:**
- Create: `scripts/audit-run-axe.sh`

- [ ] **Step 1:** Write the script.

  Create `scripts/audit-run-axe.sh`:

  ```bash
  #!/usr/bin/env bash
  # audit-run-axe.sh <route> <output-dir>
  # Runs @axe-core/cli against a production build of @switchboard/dashboard.
  # Writes axe.json + meta.txt to <output-dir>.
  set -euo pipefail

  if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <route-path> <output-dir>" >&2
    exit 2
  fi

  ROUTE="$1"
  OUT_DIR="$2"
  PORT="${PORT:-3002}"
  URL="http://localhost:${PORT}${ROUTE}"
  SHA="$(git rev-parse HEAD)"
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$OUT_DIR"

  if [[ -z "${SKIP_BUILD:-}" ]]; then
    echo "Building dashboard..."
    pnpm --filter @switchboard/dashboard build
  fi

  echo "Starting dashboard on port ${PORT}..."
  pnpm --filter @switchboard/dashboard start --port "${PORT}" &
  SERVER_PID=$!
  trap "kill ${SERVER_PID} 2>/dev/null || true" EXIT

  for i in {1..30}; do
    if curl -sf "http://localhost:${PORT}" > /dev/null; then break; fi
    sleep 1
  done

  echo "Running axe-core/cli..."
  pnpm dlx @axe-core/cli "$URL" \
    --save "${OUT_DIR}/axe.json" \
    --chrome-options="--headless"

  cat > "${OUT_DIR}/axe-meta.txt" <<EOF
  command:    audit-run-axe.sh ${ROUTE} ${OUT_DIR}
  url:        ${URL}
  build_sha:  ${SHA}
  started_at: ${STARTED_AT}
  finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  os:         $(uname -a)
  EOF

  echo "Done. Artifacts in ${OUT_DIR}"
  ```

- [ ] **Step 2:** Make executable + sanity-check.

  ```bash
  chmod +x scripts/audit-run-axe.sh
  bash scripts/audit-run-axe.sh
  ```

  Expected: prints usage, exits 2.

- [ ] **Step 3:** Commit.

  ```bash
  git add scripts/audit-run-axe.sh
  git commit -m "feat(audit): axe runner script"
  ```

---

## Task 7: Wire pnpm scripts + initial index scaffolding

**Files:**
- Modify: `package.json` — add three scripts
- Create: `docs/audits/2026-05-01-pre-launch-surface/index.md` (scaffold only)

- [ ] **Step 1:** Add scripts to `package.json`.

  In the `scripts` block, append:

  ```json
  "audit:validate": "npx tsx scripts/audit-validate-findings.ts",
  "audit:lighthouse": "bash scripts/audit-run-lighthouse.sh",
  "audit:axe": "bash scripts/audit-run-axe.sh"
  ```

- [ ] **Step 2:** Verify the scripts run.

  ```bash
  pnpm audit:validate docs/audits/2026-05-01-pre-launch-surface/_templates/findings.template.md
  ```

  Expected: prints `OK: ... (0 findings)` and exits 0.

- [ ] **Step 3:** Create the index scaffold.

  Write `docs/audits/2026-05-01-pre-launch-surface/index.md`:

  ```markdown
  # Pre-Launch Surface Audit — Triage Index

  > Source spec: [`docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md`](../../superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md)

  ## Status

  | Surface | Tier | Findings doc | PR | Closed |
  |---------|------|--------------|-----|--------|
  | 01 Dashboard core | Deep | [01](./01-dashboard-core-findings.md) | — | — |
  | 02 Dashboard secondary | Standard | [02](./02-dashboard-secondary-findings.md) | — | — |
  | 03 Marketing | Deep | [03](./03-marketing-findings.md) | — | — |
  | 04 Onboarding | Deep | [04](./04-onboarding-findings.md) | — | — |
  | 05 Chat surfaces | Standard | [05](./05-chat-findings.md) | — | — |
  | 06 Notifications | Standard | [06](./06-notifications-findings.md) | — | — |
  | 07 Operator / admin | Light | [07](./07-operator-admin-findings.md) | — | — |

  ## Severity counts

  Populated during triage (Phase C).

  ## Launch-blocker queue

  Populated during triage. Each entry references its finding ID, surface, fix spec/plan (or trivial-fix bypass PR), and Status.

  ## Calibration precedents

  Populated during Phase B as each surface's calibration ritual runs.

  ## Ship-with acknowledgments

  Populated during triage if any. Per spec §10 step 5, certain Launch-blocker classes are hard-prohibited from ship-with — check that hard-prohibition list before adding any entry here.

  ## High backlog

  Populated during triage.

  ## Re-audit gate

  See [runbook-re-audit-gate.md](./runbook-re-audit-gate.md). Run before launch per spec §13.7.

  - **Re-audit-SHA:** _set at re-audit time_
  - **Result:** _set at re-audit time_
  ```

- [ ] **Step 4:** Commit Phase A.

  ```bash
  git add docs/audits/2026-05-01-pre-launch-surface/ package.json
  git commit -m "feat(audit): pre-launch surface audit tooling and templates"
  ```

- [ ] **Step 5:** Open the Phase A PR.

  ```bash
  git push -u origin audit/tooling
  gh pr create --title "audit(pre-launch): tooling and templates" --body "$(cat <<'EOF'
  ## Summary
  - Validation script for findings docs (per spec §13.2)
  - Lighthouse + axe runners (per spec §13.3)
  - Findings + progress templates
  - Audit directory scaffolding + initial index

  ## Test plan
  - [ ] `pnpm test` passes
  - [ ] `pnpm typecheck` passes
  - [ ] `pnpm audit:validate <template>` exits 0
  - [ ] Lighthouse / axe runners print usage on no-arg invocation

  Source spec: [docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md](docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md)
  EOF
  )"
  ```

  **Wait for the PR to merge to `main` before starting Phase B.** Subsequent surface tasks branch off `main` and depend on the tooling.

---

# Phase B — Surface audits

Each surface task follows the same shape. Task 8 (Dashboard core) is documented in full as the calibration anchor; Tasks 9–14 use parallel structure with surface-specific dimension lists.

## Task 8: Surface 01 — Dashboard core (Deep, calibration anchor)

**Spec reference:** §3 row 1, §4 row 1, §5 dimensions A B C D E F G H I-light.

**Surface:** authenticated, high-traffic. Primary routes: `/console`, `/decide`, `/escalations`, `/conversations`. Confirm exact routes during pre-flight.

**Files:**
- Create: `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-progress.md`
- Create: `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`
- Create: `docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/` (Lighthouse / axe / screenshots)

**Branch:** `audit/01-dashboard-core` off `main`.

### Pre-flight

- [ ] **Step 1:** Branch.

  ```bash
  git fetch origin main
  git checkout -b audit/01-dashboard-core origin/main
  ```

- [ ] **Step 2:** Initialize progress + findings docs from the templates.

  ```bash
  cp docs/audits/2026-05-01-pre-launch-surface/_templates/progress.template.md docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-progress.md
  cp docs/audits/2026-05-01-pre-launch-surface/_templates/findings.template.md docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md
  mkdir -p docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/screenshots
  ```

  Edit the progress doc: set `Tier: Deep`, set `Session SHA at start: $(git rev-parse HEAD)`, set the date.

  Edit the findings doc front-matter: `surface: 01-dashboard-core`, `discovered_at: <SHA>`, `dimensions_in_scope: [A, B, C, D, E, F, G, H, I-light]`.

- [ ] **Step 3:** Re-read spec sections that govern this surface: §4 row 1, §5, §13.8.

- [ ] **Step 4:** Enumerate the actual routes.

  ```bash
  find apps/dashboard/src/app/\(auth\) -name page.tsx | sort
  ```

  Record the route list in the progress doc under "Routes enumerated."

- [ ] **Step 5:** Stand up the dev environment in two terminals.

  ```bash
  # Terminal 1: API
  pnpm --filter @switchboard/api dev

  # Terminal 2: dashboard
  pnpm --filter @switchboard/dashboard dev
  ```

  Verify `localhost:3002/console` loads.

### Dimension A — Visual (Claude proposes; human screenshots)

- [ ] **Step 6:** Code-read the surface's components.

  Read each route's page + zone components. Note tells: hardcoded colors not in design system, spacing/typography overrides, font-family inconsistencies, missing design-system primitives where they should be used.

  ```bash
  find apps/dashboard/src/components/console -name "*.tsx" | xargs wc -l | sort -n
  ```

  Look for any file >400 lines (per `CLAUDE.md`) — those are likely doing too much; visual issues often hide there.

- [ ] **Step 7:** Human takes desktop-width screenshots.

  At 1440px width, capture: `/console` (full page), `/decide`, `/escalations`, `/conversations`. Save to `artifacts/01-dashboard-core/screenshots/desktop/`.

- [ ] **Step 8:** Compare against design-system anchors (warm-neutral palette, Cormorant for display, Inter for body, `.section-label` 11px tracked uppercase, `.page-width` containers).

  File one finding per visual issue using the template. Each finding cites Dimension `A` (and `C` if the issue is also wording).

- [ ] **Step 9:** Tick `A — Visual` in the progress doc. If no findings, add `Checked: A — no findings` to the findings doc Coverage section.

### Dimension B — UX flow

- [ ] **Step 10:** Map the surface's user-task graph.

  Named tasks for dashboard core:
  1. As an operator with pending approvals, find them and resolve one.
  2. As an operator viewing the queue, drill into an escalation conversation and reply.
  3. As an operator new to a tenant today, get a sense of "what's going on."

- [ ] **Step 11:** Human walks each task end-to-end. Note: dead ends, redundant clicks, places where the user can't tell what to do next, places where the surface doesn't match the user's mental model.

- [ ] **Step 12:** File findings for each blocker / friction. Tick `B — UX flow`.

### Dimension C — Copy / voice

- [ ] **Step 13:** Code-read all visible strings on the surface.

  ```bash
  grep -rE '">[A-Z][a-zA-Z ]+<' apps/dashboard/src/app/\(auth\)/console apps/dashboard/src/components/console
  ```

  (And the same grep across `decide`, `escalations`, `conversations`.) Read each label / heading / hint.

- [ ] **Step 14:** Fact-check every concrete claim against actual product behavior. Examples to check: any claim about an integration ("connects to Slack"), any number ("up to 50 leads"), any timing ("within 5 seconds").

- [ ] **Step 15:** File findings for each false / unclear / off-tone string. Tick `C — Copy`.

### Dimension D — Interaction state

- [ ] **Step 16:** Force loading state via DevTools Network throttling → Slow 3G. Reload `/console`. Confirm loading skeletons render. Capture a screenshot if any zone flashes empty.

- [ ] **Step 17:** Force empty state by signing in with a tenant that has no escalations / no approvals / no activity. Confirm each zone has an empty state and it isn't a blank panel.

- [ ] **Step 18:** Force error state by stopping the API server (kill the API terminal). Reload `/console`. Confirm the spec's error banner from `1431bfa6` appears. Confirm zones don't show partial / inconsistent data.

- [ ] **Step 19:** Force partial-data state by stubbing one hook to throw. Wrap the experiment in `git stash` so the working tree mutation is reversible regardless of interruption:

  ```bash
  # before stubbing
  git -C /Users/jasonli/switchboard/.worktrees/audit-spec stash push -u -m "audit-stub-temp"

  # edit the hook (e.g., apps/dashboard/src/hooks/use-audit.ts) to throw, restart dev server, verify graceful degradation
  # then unconditionally restore:
  git -C /Users/jasonli/switchboard/.worktrees/audit-spec stash pop
  # or, if pop fails / mid-session interruption:
  git -C /Users/jasonli/switchboard/.worktrees/audit-spec checkout -- apps/dashboard/src/hooks/
  ```

  Confirm graceful degradation. The stash-pop guarantees a clean tree before the next dimension begins, and a session interruption between stubbing and verifying leaves the dirty edit in the stash (recoverable) rather than on the working tree.

- [ ] **Step 20:** File findings for each missing / broken / jarring state. Tick `D — State`.

### Dimension E — Responsive

- [ ] **Step 21:** Resize DevTools to 375px (iPhone SE). Walk the named tasks from Step 10. Note layout breaks, overflowing text, hit-targets too small, navigation not collapsing.

- [ ] **Step 22:** Resize to 768px (tablet). Note same.

- [ ] **Step 23:** Resize to 1024px. Note same.

- [ ] **Step 24:** Capture breakpoint screenshots to `artifacts/01-dashboard-core/screenshots/responsive/`. File findings. Tick `E — Responsive`.

### Dimension F — A11y

- [ ] **Step 25:** Run axe via the runner.

  ```bash
  pnpm audit:axe /console docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
  ```

  (Repeat for `/decide`, `/escalations`, `/conversations` — saving each as `axe-<route>.json`.)

- [ ] **Step 26:** Read each axe.json. Each violation becomes a finding (or roll multiple instances into one).

- [ ] **Step 27:** Keyboard-only walk: Tab through `/console`. Confirm focus is visible and follows reading order; all interactive elements reachable; no keyboard traps.

- [ ] **Step 28:** VoiceOver spot-check the primary flow (Cmd-F5 to toggle). Note unannounced state changes and unlabelled buttons.

- [ ] **Step 29:** File findings. Tick `F — A11y`.

### Dimension G — Performance

- [ ] **Step 30:** Run Lighthouse via the runner.

  ```bash
  pnpm audit:lighthouse /console docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
  ```

  (Repeat for `/decide`, `/escalations`, `/conversations` if a route shows latency tells.)

- [ ] **Step 31:** Read the desktop + mobile JSON. File findings for: Performance score < 70, LCP > 2.5s desktop / > 4s mobile, TBT > 300ms, CLS > 0.1, accessibility score < 90 (overlap with F is fine), unique unused-bytes savings > 100 KB.

- [ ] **Step 32:** Spot-check the network waterfall in DevTools for any single request > 1s on a fresh load. Tick `G — Performance`.

### Dimension H — Frontend↔backend contract

- [ ] **Step 33:** Enumerate hooks used by the surface.

  ```bash
  grep -rh "import.*from.*hooks" apps/dashboard/src/components/console apps/dashboard/src/app/\(auth\)/console | sort -u
  ```

- [ ] **Step 34:** For each hook, trace data shape from the API route (`apps/api/src/routes/...`) and the schema (`packages/schemas/src/...`).

- [ ] **Step 35:** Walk each rendered field on the surface. Confirm it maps to a real served field. Flag:
  - Placeholder cells (`—`) where the API doesn't yet serve the value (already known from Option C deferral; confirm scope).
  - "Coming soon" or static labels that overstate capabilities.
  - Fields served by API but not surfaced (potential UX miss, low severity).

- [ ] **Step 36:** File findings. Tick `H — Contract`.

### Dimension I-light — Auth

- [ ] **Step 37:** Code-read route guards.

  ```bash
  cat apps/dashboard/src/app/\(auth\)/layout.tsx
  cat apps/dashboard/src/components/app-shell.tsx
  cat apps/dashboard/src/middleware.ts 2>/dev/null || echo "no middleware"
  ```

  Confirm authenticated routes are wrapped by an auth check.

- [ ] **Step 38:** Code-read React Query cache scoping. Find `useQuery` calls in the surface's hooks. Confirm query keys include a tenant or session identifier — otherwise cache can leak across tenant switches.

- [ ] **Step 39:** Two-tenant browser repro: sign in as Tenant A in Browser 1, observe data; sign in as Tenant B in Browser 2 (or incognito); switch back to Browser 1 without a hard reload. Confirm Tenant A still sees Tenant A data, not bled-through.

- [ ] **Step 40:** Sign-out spot-check: sign out, click Back. Confirm the route redirects rather than rendering the prior view.

- [ ] **Step 41:** File findings. Any suspected cross-tenant leak gets repro'd before being escalated to Launch-blocker (per spec). Tick `I-light — Auth`.

### Closeout

- [ ] **Step 42:** Calibration ritual (§13.8).

  Compile a summary of every Launch-blocker and High proposed in this session. Read it to the user. For each:
  - User confirms severity, OR
  - User downgrades / upgrades.
  Record the call in the findings doc under "Calibration precedents (this surface)" with one-line rationale.

  Also append to `index.md` under "Calibration precedents."

- [ ] **Step 43:** Run validation.

  ```bash
  pnpm audit:validate docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md
  ```

  Expected: exits 0. If errors, fix them and re-run.

- [ ] **Step 44:** Set `session_closed: <today>` in the findings front-matter. Delete the progress doc (per §13.1).

  ```bash
  git rm docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-progress.md
  ```

- [ ] **Step 45:** Commit + PR.

  ```bash
  git add docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/ docs/audits/2026-05-01-pre-launch-surface/index.md
  git commit -m "docs(audit): dashboard-core surface findings"
  git push -u origin audit/01-dashboard-core
  gh pr create --title "audit(01): dashboard core findings" --body "Findings + Lighthouse + axe + screenshots for the dashboard-core surface. Calibration precedents recorded in index.md."
  ```

  Wait for merge before starting Task 9.

---

## Task 9: Surface 02 — Dashboard secondary (Standard)

**Spec:** §4 row 2, dimensions B, C, D, H, I-light. Tier: Standard (golden path + 1–2 obvious failure modes).

**Routes:** `/dashboard`, `/tasks`, `/my-agent`, `/me`, `/settings`. Confirm during pre-flight.

**Branch:** `audit/02-dashboard-secondary` off `main`.

- [ ] **Step 1:** Pre-flight per Task 8 Steps 1–5 (substitute `02-dashboard-secondary`, route list above, dimensions `[B, C, D, H, I-light]`).

- [ ] **Step 2:** Run dimension B per Task 8 Steps 10–12 (golden-path tasks: open settings, change a setting, see it persist; view the agent roster). Tick `B`.

- [ ] **Step 3:** Run dimension C per Task 8 Steps 13–15 (focus on settings labels and agent descriptions). Tick `C`.

- [ ] **Step 4:** Run dimension D per Task 8 Steps 16–20 — limit to loading + empty + error per Standard tier. Tick `D`.

- [ ] **Step 5:** Run dimension H per Task 8 Steps 33–36 — focus on settings forms (does the form submit a shape the API actually accepts) and `/me` profile fields. Tick `H`.

- [ ] **Step 6:** Run dimension I-light per Task 8 Steps 37–41. Tick `I-light`.

- [ ] **Step 7:** Closeout per Task 8 Steps 42–45 (substitute `02-dashboard-secondary`).

---

## Task 10: Surface 03 — Marketing (Deep)

**Spec:** §4 row 3, dimensions A, C, E, G, B-light, F-light. No auth, no contract. F-light = keyboard nav + axe automated only. B-light = golden-path only.

**Routes:** `/`, `/agents`, `/how-it-works`, `/pricing`, `/privacy`, `/terms`. Confirm during pre-flight.

**Branch:** `audit/03-marketing` off `main`.

- [ ] **Step 1:** Pre-flight per Task 8 Steps 1–5 (substitute `03-marketing`, dimensions `[A, C, E, G, B-light, F-light]`).

- [ ] **Step 2:** Dimension A — visual quality across landing pages. Capture desktop screenshots. Tick `A`.

- [ ] **Step 3:** Dimension C — copy/voice. Fact-check every concrete claim against the **truth-up** spec (`docs/superpowers/specs/2026-04-29-marketing-copy-truth-up-design.md`) and the v6 landing PR (`#310`). Tick `C`.

- [ ] **Step 4:** Dimension E — responsive at 375 / 768 / 1024 / 1440. Capture screenshots per breakpoint. Marketing pages must look intentional on mobile. Tick `E`.

- [ ] **Step 5:** Dimension G — Lighthouse desktop + mobile for `/`, `/pricing`, and the most image-heavy landing page. Marketing perf bar: Performance ≥ 80, LCP ≤ 2.5s, CLS ≤ 0.1. Tick `G`.

- [ ] **Step 6:** Dimension B-light — golden-path walkthrough only. As a first-time visitor, can I get from `/` to `/signup` in ≤ 3 clicks and understand what I'm signing up for? Tick `B-light`.

- [ ] **Step 7:** Dimension F-light — axe only + keyboard nav + contrast. Run axe per route. Tab through every page; confirm focus visibility. Skip VoiceOver deep walk. Tick `F-light`.

- [ ] **Step 8:** Closeout per Task 8 Steps 42–45 (substitute `03-marketing`).

---

## Task 11: Surface 04 — Onboarding (Deep)

**Spec:** §4 row 4, dimensions B, C, D, E, H, I-light, G-light. G-light = mobile Lighthouse only; flag scores < 70 or LCP > 4s.

**Routes:** `/get-started`, `/signup`, `/login`, `/onboarding` (in-product wizard). Confirm during pre-flight.

**Branch:** `audit/04-onboarding` off `main`.

- [ ] **Step 1:** Pre-flight per Task 8 Steps 1–5 (substitute `04-onboarding`, dimensions `[B, C, D, E, H, I-light, G-light]`).

- [ ] **Step 2:** Dimension B — full conversion-funnel walkthrough as a brand-new user.

  Named tasks:
  1. From `/get-started`, complete signup and reach the first authenticated screen.
  2. Complete the in-product wizard (`/onboarding`) front-to-back without backtracking.
  3. Recover from a duplicate-email signup attempt.
  4. Recover from an expired magic-link / login link.

  File findings for each blocker. Errors here = users never reach product. **Severity bias upward.** Tick `B`.

- [ ] **Step 3:** Dimension C — fact-check every claim made during the funnel against actual capability. Tick `C`.

- [ ] **Step 4:** Dimension D — force every error state in the funnel: invalid email, weak password (if applicable), API down, slow network, duplicate account. Each must have an actionable error message. Tick `D`.

- [ ] **Step 5:** Dimension E — funnel must work on 375px. Capture screenshots per breakpoint. Tick `E`.

- [ ] **Step 6:** Dimension H — code-read the signup / login route handlers (`apps/dashboard/src/app/login/page.tsx`, `apps/dashboard/src/app/(auth)/onboarding/page.tsx`) against the API surface they call. Confirm the contract holds. Tick `H`.

- [ ] **Step 7:** Dimension I-light — confirm `/onboarding` is auth-gated; magic links are single-use and expire; signed-out users hitting `/onboarding` are redirected to `/login`. Tick `I-light`.

- [ ] **Step 8:** Dimension G-light — Lighthouse mobile for `/`, `/signup`, `/onboarding`. Flag scores < 70 or LCP > 4s. Tick `G-light`.

- [ ] **Step 9:** Closeout per Task 8 Steps 42–45 (substitute `04-onboarding`).

---

## Task 12: Surface 05 — Chat surfaces (Standard)

**Spec:** §4 row 5, dimensions B, C, D, H. Operator-visible rendering of Telegram/WhatsApp/Slack messages within the dashboard.

**Routes / components:** `/conversations` route + any approval-card preview that renders chat content. Confirm during pre-flight by `find apps/dashboard/src/components -name "*chat*" -o -name "*message*"`.

**Branch:** `audit/05-chat` off `main`.

- [ ] **Step 1:** Pre-flight per Task 8 Steps 1–5 (substitute `05-chat`, dimensions `[B, C, D, H]`).

- [ ] **Step 2:** Dimension B — operator can find a conversation, read it, see who said what, take an action (reply / approve / escalate). Tick `B`.

- [ ] **Step 3:** Dimension C — agent voice consistency. Read several agent-authored messages from real conversation samples (use `useEscalations()` data). Does the agent sound coherent across turns? Are timestamps, attribution, status indicators correct? Tick `C`.

- [ ] **Step 4:** Dimension D — force long-message rendering, multi-line message rendering, malformed-payload rendering, very-old conversation rendering, very-new (real-time arriving) message rendering. Tick `D`.

- [ ] **Step 5:** Dimension H — code-read the message-rendering component(s) against the conversation/message schemas in `packages/schemas`. Confirm every message field used in UI is served by the API. Confirm the operator preview shape matches the chat handler shape. Tick `H`.

- [ ] **Step 6:** Closeout per Task 8 Steps 42–45 (substitute `05-chat`).

---

## Task 13: Surface 06 — Notifications (Standard)

**Spec:** §4 row 6, dimensions C, D, H, J. J = notifications-specific deliverability + link safety (§5).

**Surface:** outbound email and any other system-originated user-facing messages. Identify during pre-flight by searching for email senders / mailers / template files: `grep -rE "sendMail|nodemailer|resend|@react-email" apps/ packages/`.

**Branch:** `audit/06-notifications` off `main`.

- [ ] **Step 1:** Pre-flight per Task 8 Steps 1–5 (substitute `06-notifications`, dimensions `[C, D, H, J]`).

  Inventory the notification surface: list each notification type sent (signup confirmation, magic link, escalation alert, billing receipt, etc.). Record the list in the progress doc.

- [ ] **Step 2:** Dimension C — read each notification template's copy. Tone, clarity, accuracy. Tick `C`.

- [ ] **Step 3:** Dimension D — for each notification, render it in a test send (or a fixture viewer if one exists) for: short tenant name, long tenant name, missing optional field, very long body. Confirm rendering doesn't break. Tick `D`.

- [ ] **Step 4:** Dimension H — code-read each template against the data it's handed. Confirm every variable interpolation has a real source. Confirm the env-domain (`process.env.PUBLIC_URL` or similar) used in links resolves to the correct environment. Tick `H`.

- [ ] **Step 5:** Dimension J — deliverability + link safety:

  - [ ] **J.a** Every link in every template uses the correct env domain (no staging / localhost in prod).
  - [ ] **J.b** Tenant-scoped links carry the correct tenant identifier and don't leak across tenants (manually trigger a notification for two different tenants; diff the rendered HTML).
  - [ ] **J.c** Magic-link / session-bearing URLs are single-use and expire (try replaying a consumed link).
  - [ ] **J.d** Unsubscribe + legal footer present where the message type requires it (any marketing / non-transactional message).
  - [ ] **J.e** Every link resolves with a 200 (no 404s, no infinite redirects). Use `curl -I` for each unique URL in a sent message.

  File findings per check. Tick `J`.

- [ ] **Step 6:** Closeout per Task 8 Steps 42–45 (substitute `06-notifications`). **Reminder:** any data-leak / wrong-tenant / payment / auth finding here is hard-prohibited from ship-with per spec §10.

---

## Task 14: Surface 07 — Operator / admin (Light)

**Spec:** §4 row 7, dimensions B, H, I-light. Smoke test only.

**Routes:** any internal-only surfaces present at audit time. Identify during pre-flight: `grep -rE "(admin|operator|internal).*page" apps/dashboard/src/app/`. May be empty, in which case the task is to confirm absence.

**Branch:** `audit/07-operator-admin` off `main`.

- [ ] **Step 1:** Pre-flight per Task 8 Steps 1–5 (substitute `07-operator-admin`, dimensions `[B, H, I-light]`). If no operator/admin routes exist, record that in the findings doc as `Coverage: no operator/admin surface present at SHA <sha>` and skip to Step 5.

- [ ] **Step 2:** Dimension B — does each operator surface complete its named task without dead-ends? Tick `B`.

- [ ] **Step 3:** Dimension H — code-read the API endpoints these surfaces hit. Are they restricted to operators? Tick `H`.

- [ ] **Step 4:** Dimension I-light — confirm operator routes are gated by an operator check, not just an authenticated check. Cross-role spot-check: a regular tenant user hits the route → expect redirect or 403. Tick `I-light`.

- [ ] **Step 5:** Closeout per Task 8 Steps 42–45 (substitute `07-operator-admin`).

---

# Phase C — Triage

## Task 15: Cross-surface triage roll-up

**Spec:** §10. **Branch:** `audit/triage` off `main` (after all 7 surface PRs are merged).

**Files:**
- Modify: `docs/audits/2026-05-01-pre-launch-surface/index.md`

- [ ] **Step 1:** Branch.

  ```bash
  git fetch origin main
  git checkout -b audit/triage origin/main
  ```

- [ ] **Step 2:** Roll-up — aggregate every finding into the index, grouped by severity.

  Use a one-shot grep to extract findings:

  ```bash
  for f in docs/audits/2026-05-01-pre-launch-surface/0*-findings.md; do
    awk '/^## [A-Z][A-Z]-[0-9]+/{id=$2} /^- \*\*Severity:\*\*/{print FILENAME, id, $0}' "$f"
  done
  ```

  Populate index.md "Severity counts" table and the per-severity find list.

- [ ] **Step 3:** Bidirectional re-calibration (§10 step 2).

  Re-read every Launch-blocker as a set. For each, ask: *would I advise delay over this?* If no → demote to High and update the originating findings doc.

  Re-read every High. For each, ask: *would I advise delay over this?* If yes → promote to Launch-blocker and update the originating findings doc.

  Record promotions/demotions under "Calibration precedents" in `index.md` with rationale. Update the Status / severity in the source findings docs.

- [ ] **Step 4:** Order Launch-blockers (§10 step 3) by (a) blast radius, (b) effort, (c) coupling. Write the ordered queue to index.md.

- [ ] **Step 5:** Spec the fixes (§10 step 4).

  For each Launch-blocker:
  - If it qualifies for the trivial-fix bypass (§13.4): file a fix PR directly. Set Status to `Fixed (PR #__)` once merged.
  - Otherwise: write a follow-up spec under `docs/superpowers/specs/2026-05-XX-<fix-name>-design.md` and a plan under `docs/superpowers/plans/...`. Cross-reference from index.md.

  **Hard-prohibited classes** (data leak, wrong-tenant, broken auth, payment, security with exploit path) **must** get specs + fixes — never ship-with.

- [ ] **Step 6:** Ship-with acknowledgments for any Launch-blockers the user wants to ship with anyway. For each, add the structured entry to index.md per spec §10 step 5. **Reject** any entry whose finding is in the hard-prohibited classes — those go back to Step 5.

- [ ] **Step 7:** High backlog — populate index.md with each High, effort estimate, and disposition (scheduled / downgraded-with-rationale / ship-with).

- [ ] **Step 8:** Cross-surface dedup (§13.5). For each finding, scan other surfaces for duplicates. Merge into a single triage entry that lists all surfaces affected; the original per-surface findings keep their IDs and reference the merged entry.

- [ ] **Step 9:** Validate every findings doc still passes after status updates.

  ```bash
  for f in docs/audits/2026-05-01-pre-launch-surface/0*-findings.md; do
    pnpm audit:validate "$f"
  done
  ```

  Expected: every file exits 0.

- [ ] **Step 10:** Commit + PR.

  ```bash
  git add docs/audits/2026-05-01-pre-launch-surface/
  git commit -m "docs(audit): cross-surface triage and launch-blocker queue"
  git push -u origin audit/triage
  gh pr create --title "audit: cross-surface triage" --body "Roll-up of 7 surface audits, bidirectional re-calibration, ordered launch-blocker queue, ship-with entries (if any), High backlog. Per spec §10."
  ```

---

# Phase D — Re-audit gate runbook

## Task 16: Re-audit gate runbook

**Spec:** §13.7. **Branch:** can ride `audit/triage` (same PR) or be its own short branch.

**Files:**
- Create: `docs/audits/2026-05-01-pre-launch-surface/runbook-re-audit-gate.md`

- [ ] **Step 1:** Write the runbook.

  ```markdown
  # Re-Audit Gate Runbook

  > Spec §13.7. Run before launch on the launch-candidate commit.

  ## Inputs

  - Launch-candidate commit SHA.
  - Original findings docs in this directory.
  - Original artifacts under `artifacts/0[1-7]-<surface>/`.

  ## Procedure

  1. **Record SHA.** Update `index.md` field `Re-audit-SHA: <SHA>` (do this on a normal branch off `main`, not in detached HEAD).

  2. **Set up an isolated re-audit worktree at the launch SHA.**

     Avoid `git checkout <SHA>` in the main checkout — detached HEAD writes get lost on next checkout. Use a worktree instead:

     ```bash
     git fetch origin
     git worktree add /Users/jasonli/switchboard/.worktrees/re-audit-<short-SHA> <SHA>
     cd /Users/jasonli/switchboard/.worktrees/re-audit-<short-SHA>
     pnpm install --frozen-lockfile
     ```

     Run all subsequent automated re-audits from this worktree.

  3. **Re-run automated dimensions per surface.**

     For each surface where G or F was in scope:

     ```bash
     # Inside the re-audit worktree, write artifacts to a temp dir (NOT under docs/audits — that would be lost when this detached worktree is removed)
     OUT=/tmp/re-audit-<short-SHA>/0N-<surface>
     mkdir -p "$OUT"
     pnpm audit:lighthouse <route> "$OUT"
     pnpm audit:axe <route> "$OUT"
     ```

  4. **Move artifacts back to the main repo.**

     Switch to a normal branch off `main` in the main checkout (e.g., `audit/re-audit-<short-SHA>`), copy the artifacts in, and commit:

     ```bash
     cd /Users/jasonli/switchboard
     git fetch origin main && git checkout -b audit/re-audit-<short-SHA> origin/main
     mkdir -p docs/audits/2026-05-01-pre-launch-surface/artifacts/re-audit-<SHA>
     cp -r /tmp/re-audit-<short-SHA>/* docs/audits/2026-05-01-pre-launch-surface/artifacts/re-audit-<SHA>/
     ```

  5. **Diff against original artifacts.**

     For each Lighthouse JSON, compare top-level scores (Performance, Accessibility, Best Practices, SEO) and key metrics (LCP, TBT, CLS).
     For each axe JSON, compare violation counts by impact level.
     Any new issue at Launch-blocker severity (per spec §7 calibrated examples) blocks the launch.

  6. **Stale-finding rule (spec §13.6).** If >2 weeks have elapsed since a surface's audit AND that surface has substantive UI changes (`git log --oneline <original-SHA>..<re-audit-SHA> -- apps/dashboard/src/app/<surface-routes>` returns >1 commit), re-run that surface's manual dimensions in the re-audit worktree.

  7. **Sample manual re-check.** Pick 1 surface (rotate per re-audit). Re-run its manual dimensions on the launch-candidate (in the worktree). Note any new findings as `Post-close: true` per spec §10 step 7. Record those findings on the `audit/re-audit-<short-SHA>` branch (in the main checkout), not in the worktree.

  8. **Record result.** Update `index.md` on the `audit/re-audit-<short-SHA>` branch:
     - `Re-audit-SHA: <SHA>`
     - `Result: PASSED` (no new Launch-blockers) or `BLOCKED` (list new Launch-blockers).
     - Link to the re-audit artifacts dir.

  9. **Commit + PR.**

     ```bash
     git add docs/audits/2026-05-01-pre-launch-surface/
     git commit -m "docs(audit): re-audit gate result for <short-SHA>"
     git push -u origin audit/re-audit-<short-SHA>
     gh pr create --title "audit: re-audit gate result for <short-SHA>" --body "..."
     ```

  10. **Tear down the re-audit worktree** once the PR is merged:

      ```bash
      git worktree remove /Users/jasonli/switchboard/.worktrees/re-audit-<short-SHA>
      git worktree prune
      ```

  ## Pass criteria

  - No new Launch-blockers in any automated diff.
  - Stale-finding manual re-runs (if triggered) introduce no new Launch-blockers.
  - Sample manual re-check introduces no new Launch-blockers.

  ## Block criteria

  Any new Launch-blocker. Surface it to the user; they decide ship vs. delay.
  ```

- [ ] **Step 2:** Commit (alongside Task 15 PR or separately).

  ```bash
  git add docs/audits/2026-05-01-pre-launch-surface/runbook-re-audit-gate.md
  git commit -m "docs(audit): pre-launch re-audit gate runbook"
  ```

---

## Plan-level success criteria

The plan is fully executed when, in order:

1. Phase A PR is merged. `pnpm audit:validate`, `pnpm audit:lighthouse`, `pnpm audit:axe` all work from `main`.
2. All seven Phase B PRs are merged. Each surface has a findings doc, artifacts, and progress doc deleted.
3. Phase C PR is merged. `index.md` lists severity counts, ordered launch-blocker queue, calibration precedents, ship-with entries (if any), High backlog. All findings docs pass validation after the triage updates.
4. Phase D PR is merged. The re-audit gate runbook is in place.
5. Every Launch-blocker has Status `Fixed (PR #__)` or `Accepted (ship-with)` (with no entry in the hard-prohibited classes).

The audit is operationally closed when the re-audit gate has run on the launch candidate per the Phase D runbook and produced `PASSED`.
