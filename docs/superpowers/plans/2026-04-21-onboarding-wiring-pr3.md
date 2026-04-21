# PR 3 — Onboarding Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real behavior into the onboarding flow — website scan → playbook hydration, interview response parsing, TestCenter simulation, and small UX features (send button, new-message pill, section-updated indicator, channel icons, hours in GoLive summary).

**Architecture:** The onboarding page (`apps/dashboard/src/app/(auth)/onboarding/page.tsx`) orchestrates 4 steps. Step 1 (OnboardingEntry) already captures `scanUrl`. Step 2 (TrainingShell) has a working interview engine with stubbed `processResponse()`. Step 3 (TestCenter) receives empty props. Step 4 (GoLive) is missing hours in summary. This plan wires real behavior into each without changing the page orchestration shape.

**Tech Stack:** Next.js 14, React, TanStack React Query, Vitest + React Testing Library, Tailwind CSS, Zod schemas from `@switchboard/schemas`

**Key design principles for this PR:**

- Scan-hydrated fields always enter as `check_this` — only user-confirmed content becomes `ready`
- Interview parsers are pure functions per section, not a monolithic switch
- Prompt categories match the approved TestCenter UX: BOOKING, PRICING, CHANGES, EDGE_CASES
- API paths are explicit: dashboard hook → Next.js proxy (`/api/dashboard/simulate`) → backend (`/api/simulate-chat`)
- Annotations describe "inputs used" not "reasoning"

---

## File Map

| Action | File                                                                               | Responsibility                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create | `apps/dashboard/src/lib/scan-to-playbook.ts`                                       | Pure function: `ScanResult` → `Playbook` hydration. All scan-sourced fields enter as `check_this`. Accepts `idFactory` for testability.                                                |
| Create | `apps/dashboard/src/lib/__tests__/scan-to-playbook.test.ts`                        | Tests for scan-to-playbook mapping                                                                                                                                                     |
| Create | `apps/dashboard/src/lib/interview-parsers.ts`                                      | Per-section pure parser functions: `parseBusinessIdentityResponse`, `parseServicesResponse`, `parseHoursResponse`, `parseEscalationTriggers`. Each returns structured shape or `null`. |
| Create | `apps/dashboard/src/lib/__tests__/interview-parsers.test.ts`                       | Tests for each parser                                                                                                                                                                  |
| Modify | `apps/dashboard/src/lib/interview-engine.ts`                                       | `processResponse()` delegates to per-section parsers, preserves raw text in `unparsedInput` when confidence is low                                                                     |
| Modify | `apps/dashboard/src/lib/__tests__/interview-engine.test.ts`                        | Tests for real `processResponse()` behavior                                                                                                                                            |
| Create | `apps/dashboard/src/lib/interview-apply.ts`                                        | `applyInterviewUpdate(playbook, update): Playbook` — pure function that applies `ResponseUpdate` to playbook                                                                           |
| Create | `apps/dashboard/src/lib/__tests__/interview-apply.test.ts`                         | Tests for playbook application                                                                                                                                                         |
| Modify | `apps/dashboard/src/components/onboarding/training-shell.tsx`                      | Wire `useWebsiteScan` with dedupe guards, use `applyInterviewUpdate`                                                                                                                   |
| Create | `apps/dashboard/src/lib/prompt-generator.ts`                                       | Generate `TestPrompt[]` from a `Playbook`. Categories: BOOKING, PRICING, CHANGES, EDGE_CASES                                                                                           |
| Create | `apps/dashboard/src/lib/__tests__/prompt-generator.test.ts`                        | Tests for prompt generation                                                                                                                                                            |
| Create | `apps/api/src/routes/simulate-chat.ts`                                             | Backend: takes playbook + user message, calls Claude Haiku, returns response + annotations                                                                                             |
| Modify | `apps/api/src/bootstrap/routes.ts`                                                 | Register `simulate-chat` route                                                                                                                                                         |
| Create | `apps/dashboard/src/app/api/dashboard/simulate/route.ts`                           | Next.js proxy route to backend `/api/simulate-chat`                                                                                                                                    |
| Modify | `apps/dashboard/src/lib/api-client.ts`                                             | Add `simulateChat()` method calling `/api/simulate-chat`                                                                                                                               |
| Create | `apps/dashboard/src/hooks/use-simulation.ts`                                       | Hook: POST to `/api/dashboard/simulate`, returns response                                                                                                                              |
| Modify | `apps/dashboard/src/app/(auth)/onboarding/page.tsx`                                | Wire prompt generator + simulation hook into step 3, pass `scenariosTested` to step 4                                                                                                  |
| Modify | `apps/dashboard/src/components/onboarding/test-center.tsx`                         | Add `onRerunPrompt(promptId)` prop (F4), zero-test gate (F5)                                                                                                                           |
| Modify | `apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx`          | Tests for re-run + zero-test gate                                                                                                                                                      |
| Modify | `apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx`                 | v1: contextual guidance for "Wrong info" — shows section name + link to playbook (F6)                                                                                                  |
| Create | `apps/dashboard/src/components/onboarding/__tests__/fix-this-slide-over.test.tsx`  | Tests for wrong-info path                                                                                                                                                              |
| Modify | `apps/dashboard/src/components/onboarding/alex-chat.tsx`                           | Send button (F7), new-message pill (F8)                                                                                                                                                |
| Modify | `apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx`            | Tests for send button + new-message pill                                                                                                                                               |
| Modify | `apps/dashboard/src/components/onboarding/playbook-panel.tsx`                      | Panel-local section-updated indicator (F9)                                                                                                                                             |
| Modify | `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`                | Channel icons (F10)                                                                                                                                                                    |
| Create | `apps/dashboard/src/components/onboarding/__tests__/channel-connect-card.test.tsx` | Tests for icon rendering                                                                                                                                                               |
| Modify | `apps/dashboard/src/components/onboarding/go-live.tsx`                             | Hours in summary using explicit weekday order (F11)                                                                                                                                    |
| Modify | `apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx`              | Tests for hours in summary                                                                                                                                                             |

---

## Task 1: Scan-to-Playbook Transformer

**Files:**

- Create: `apps/dashboard/src/lib/scan-to-playbook.ts`
- Create: `apps/dashboard/src/lib/__tests__/scan-to-playbook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/lib/__tests__/scan-to-playbook.test.ts
import { describe, it, expect } from "vitest";
import { hydratePlaybookFromScan } from "../scan-to-playbook";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { ScanResult } from "@switchboard/schemas";

describe("hydratePlaybookFromScan", () => {
  const idFactory = (i: number) => `scan-${i}`;

  it("maps businessName and category into businessIdentity as check_this", () => {
    const scan: ScanResult = {
      businessName: { value: "Bright Smile Dental", confidence: "high" },
      category: { value: "Dental Clinic", confidence: "medium" },
      location: { value: "Singapore", confidence: "high" },
      services: [],
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.businessIdentity.name).toBe("Bright Smile Dental");
    expect(result.businessIdentity.category).toBe("Dental Clinic");
    expect(result.businessIdentity.location).toBe("Singapore");
    expect(result.businessIdentity.status).toBe("check_this");
    expect(result.businessIdentity.source).toBe("scan");
  });

  it("maps all services as check_this regardless of confidence", () => {
    const scan: ScanResult = {
      services: [
        { name: "Teeth Whitening", price: 450, duration: 60, confidence: "high" },
        { name: "Cleaning", confidence: "medium" },
      ],
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("Teeth Whitening");
    expect(result.services[0].price).toBe(450);
    expect(result.services[0].duration).toBe(60);
    expect(result.services[0].status).toBe("check_this");
    expect(result.services[0].source).toBe("scan");
    expect(result.services[1].status).toBe("check_this");
  });

  it("uses deterministic IDs from idFactory", () => {
    const scan: ScanResult = {
      services: [
        { name: "A", confidence: "high" },
        { name: "B", confidence: "high" },
      ],
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.services[0].id).toBe("scan-0");
    expect(result.services[1].id).toBe("scan-1");
  });

  it("maps hours schedule as check_this", () => {
    const scan: ScanResult = {
      services: [],
      hours: { mon: "09:00-18:00", tue: "09:00-18:00", sat: "10:00-14:00" },
      contactMethods: [],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.hours.schedule).toEqual({
      mon: "09:00-18:00",
      tue: "09:00-18:00",
      sat: "10:00-14:00",
    });
    expect(result.hours.status).toBe("check_this");
    expect(result.hours.source).toBe("scan");
  });

  it("sets contactMethods as channel hints", () => {
    const scan: ScanResult = {
      services: [],
      contactMethods: ["WhatsApp", "Phone"],
      faqHints: [],
    };
    const result = hydratePlaybookFromScan(createEmptyPlaybook(), scan, idFactory);
    expect(result.channels.configured).toEqual(["WhatsApp", "Phone"]);
    expect(result.channels.status).toBe("check_this");
  });

  it("leaves sections untouched when scan data is absent", () => {
    const scan: ScanResult = { services: [], contactMethods: [], faqHints: [] };
    const base = createEmptyPlaybook();
    const result = hydratePlaybookFromScan(base, scan, idFactory);
    expect(result.businessIdentity.status).toBe("missing");
    expect(result.hours.status).toBe("missing");
    expect(result.bookingRules.status).toBe("missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/scan-to-playbook.test.ts`
Expected: FAIL — module `../scan-to-playbook` not found

- [ ] **Step 3: Implement scan-to-playbook**

```typescript
// apps/dashboard/src/lib/scan-to-playbook.ts
import type { Playbook, ScanResult } from "@switchboard/schemas";

type IdFactory = (index: number) => string;
const defaultIdFactory: IdFactory = () => crypto.randomUUID();

export function hydratePlaybookFromScan(
  base: Playbook,
  scan: ScanResult,
  idFactory: IdFactory = defaultIdFactory,
): Playbook {
  const playbook = structuredClone(base);

  if (scan.businessName || scan.category || scan.location) {
    playbook.businessIdentity = {
      ...playbook.businessIdentity,
      name: scan.businessName?.value ?? playbook.businessIdentity.name,
      category: scan.category?.value ?? playbook.businessIdentity.category,
      location: scan.location?.value ?? playbook.businessIdentity.location,
      status: "check_this",
      source: "scan",
    };
  }

  if (scan.services.length > 0) {
    playbook.services = scan.services.map((s, i) => ({
      id: idFactory(i),
      name: s.name,
      price: s.price,
      duration: s.duration,
      bookingBehavior: "ask_first" as const,
      status: "check_this" as const,
      source: "scan" as const,
    }));
  }

  if (scan.hours && Object.keys(scan.hours).length > 0) {
    playbook.hours = {
      ...playbook.hours,
      schedule: scan.hours,
      status: "check_this",
      source: "scan",
    };
  }

  if (scan.contactMethods.length > 0) {
    playbook.channels = {
      ...playbook.channels,
      configured: scan.contactMethods,
      status: "check_this",
      source: "scan",
    };
  }

  return playbook;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/scan-to-playbook.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add scan-to-playbook transformer

Pure function that maps ScanResult into Playbook hydration.
All scan-sourced fields enter as check_this — user confirms to ready.
Accepts idFactory for deterministic testing.
EOF
)"
```

---

## Task 2: Interview Response Parsers

**Files:**

- Create: `apps/dashboard/src/lib/interview-parsers.ts`
- Create: `apps/dashboard/src/lib/__tests__/interview-parsers.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/dashboard/src/lib/__tests__/interview-parsers.test.ts
import { describe, it, expect } from "vitest";
import {
  parseBusinessIdentityResponse,
  parseServicesResponse,
  parseHoursResponse,
  parseEscalationTriggers,
} from "../interview-parsers";

describe("parseBusinessIdentityResponse", () => {
  it("strips common prefixes and extracts name", () => {
    expect(parseBusinessIdentityResponse("We're Bright Smile Dental, a dental clinic")).toEqual({
      name: "Bright Smile Dental",
    });
  });

  it("handles simple name without prefix", () => {
    expect(parseBusinessIdentityResponse("Bright Smile Dental")).toEqual({
      name: "Bright Smile Dental",
    });
  });

  it("returns null for empty input", () => {
    expect(parseBusinessIdentityResponse("")).toBeNull();
    expect(parseBusinessIdentityResponse("  ")).toBeNull();
  });
});

describe("parseServicesResponse", () => {
  it("extracts services with dollar prices", () => {
    const result = parseServicesResponse("Teeth whitening $450, cleaning $80");
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ name: "Teeth whitening", price: 450 });
    expect(result![1]).toEqual({ name: "cleaning", price: 80 });
  });

  it("extracts services without prices", () => {
    const result = parseServicesResponse("Consultation, follow-up");
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ name: "Consultation" });
    expect(result![1]).toEqual({ name: "follow-up" });
  });

  it("returns null for empty input", () => {
    expect(parseServicesResponse("")).toBeNull();
  });

  it("handles newline-separated services", () => {
    const result = parseServicesResponse("Whitening $450\nCleaning $80\nInvisalign $5000");
    expect(result).toHaveLength(3);
  });
});

describe("parseHoursResponse", () => {
  it("returns raw text as schedule (structured parsing is v2)", () => {
    const result = parseHoursResponse("Mon-Fri 9am to 6pm, Saturday 10am to 2pm");
    expect(result).toEqual({ schedule: "Mon-Fri 9am to 6pm, Saturday 10am to 2pm" });
  });

  it("returns null for empty input", () => {
    expect(parseHoursResponse("")).toBeNull();
  });
});

describe("parseEscalationTriggers", () => {
  it("splits comma-separated triggers", () => {
    expect(parseEscalationTriggers("refund, complaint, legal")).toEqual([
      "refund",
      "complaint",
      "legal",
    ]);
  });

  it("splits semicolon-separated triggers", () => {
    expect(parseEscalationTriggers("refund; complaint")).toEqual(["refund", "complaint"]);
  });

  it("returns null for empty input", () => {
    expect(parseEscalationTriggers("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/interview-parsers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parsers**

```typescript
// apps/dashboard/src/lib/interview-parsers.ts

const NAME_PREFIXES = /^(we're|i'm|it's|we are|i am|this is|my business is|it is)\s+/i;

export function parseBusinessIdentityResponse(text: string): { name: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstPhrase = trimmed.split(",")[0].replace(NAME_PREFIXES, "").trim();
  return firstPhrase ? { name: firstPhrase } : null;
}

export function parseServicesResponse(
  text: string,
): Array<{ name: string; price?: number }> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed
    .split(/[,;\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  return lines
    .map((line) => {
      const priceMatch = line.match(/\$(\d+(?:\.\d{2})?)/);
      const name = line
        .replace(/\$\d+(?:\.\d{2})?/, "")
        .replace(/[-–—]/, "")
        .trim();
      if (!name) return null;
      return { name, ...(priceMatch ? { price: parseFloat(priceMatch[1]) } : {}) };
    })
    .filter((s): s is { name: string; price?: number } => s !== null);
}

export function parseHoursResponse(text: string): { schedule: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { schedule: trimmed };
}

export function parseEscalationTriggers(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const triggers = trimmed
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return triggers.length > 0 ? triggers : null;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/interview-parsers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add per-section interview response parsers

Pure functions: parseBusinessIdentityResponse, parseServicesResponse,
parseHoursResponse, parseEscalationTriggers. Each returns structured
shape or null. Hours remain as raw text (structured parsing is v2).
EOF
)"
```

---

## Task 3: Implement InterviewEngine.processResponse()

**Files:**

- Modify: `apps/dashboard/src/lib/interview-engine.ts`
- Modify: `apps/dashboard/src/lib/__tests__/interview-engine.test.ts`

- [ ] **Step 1: Write failing tests for processResponse**

Add to `apps/dashboard/src/lib/__tests__/interview-engine.test.ts`:

```typescript
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { InterviewQuestion } from "../interview-engine";

describe("processResponse — real parsing", () => {
  it("extracts business name from identity question response", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-businessIdentity",
      targetSection: "businessIdentity",
      type: "ask",
      prompt: "What's your business called?",
      contextHint: "",
    };
    const result = engine.processResponse(
      question,
      "We're Bright Smile Dental, a dental clinic in Orchard Road",
    );
    expect(result.fields).toHaveProperty("name", "Bright Smile Dental");
    expect(result.newStatus).toBe("check_this");
  });

  it("extracts services from services question response", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-services",
      targetSection: "services",
      type: "ask",
      prompt: "What services do you offer?",
      contextHint: "",
    };
    const result = engine.processResponse(
      question,
      "Teeth whitening $450, cleaning $80, Invisalign $150",
    );
    const services = result.fields.services as Array<{ name: string; price?: number }>;
    expect(services.length).toBe(3);
    expect(services[0].name).toBe("Teeth whitening");
    expect(services[0].price).toBe(450);
  });

  it("stores raw text in unparsedInput for hours", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-hours",
      targetSection: "hours",
      type: "ask",
      prompt: "What are your hours?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "Monday to Friday 9am to 6pm");
    expect(result.fields).toHaveProperty("unparsedInput", "Monday to Friday 9am to 6pm");
    expect(result.newStatus).toBe("check_this");
  });

  it("stores raw text for booking rules as leadVsBooking", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-bookingRules",
      targetSection: "bookingRules",
      type: "ask",
      prompt: "How do you handle bookings?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "Qualify first then book");
    expect(result.fields).toHaveProperty("leadVsBooking", "Qualify first then book");
    expect(result.newStatus).toBe("check_this");
  });

  it("extracts escalation triggers from comma-separated list", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-escalation",
      targetSection: "escalation",
      type: "ask",
      prompt: "What should Alex escalate?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "refund, complaint, legal");
    expect(result.fields.triggers).toEqual(["refund", "complaint", "legal"]);
    expect(result.newStatus).toBe("check_this");
  });

  it("preserves unparsedInput for sections without structured parsers", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question: InterviewQuestion = {
      id: "q-approvalMode",
      targetSection: "approvalMode",
      type: "ask",
      prompt: "How much autonomy?",
      contextHint: "",
    };
    const result = engine.processResponse(question, "Ask me before booking anything");
    expect(result.fields).toHaveProperty("unparsedInput", "Ask me before booking anything");
    expect(result.newStatus).toBe("check_this");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/interview-engine.test.ts`
Expected: FAIL — processResponse returns empty `fields: {}`

- [ ] **Step 3: Update processResponse to delegate to parsers**

In `apps/dashboard/src/lib/interview-engine.ts`, add import:

```typescript
import {
  parseBusinessIdentityResponse,
  parseServicesResponse,
  parseEscalationTriggers,
} from "./interview-parsers";
```

Replace the `processResponse` method:

```typescript
processResponse(question: InterviewQuestion, response: string): ResponseUpdate {
  this.askedSections.add(question.targetSection);
  const section = question.targetSection;
  const text = response.trim();

  switch (section) {
    case "businessIdentity": {
      const parsed = parseBusinessIdentityResponse(text);
      return {
        section,
        fields: parsed ?? { unparsedInput: text },
        newStatus: "check_this",
      };
    }
    case "services": {
      const parsed = parseServicesResponse(text);
      return {
        section,
        fields: parsed ? { services: parsed } : { unparsedInput: text },
        newStatus: "check_this",
      };
    }
    case "hours": {
      return {
        section,
        fields: { unparsedInput: text },
        newStatus: "check_this",
      };
    }
    case "bookingRules": {
      return {
        section,
        fields: { leadVsBooking: text },
        newStatus: "check_this",
      };
    }
    case "escalation": {
      const triggers = parseEscalationTriggers(text);
      return {
        section,
        fields: triggers ? { triggers } : { unparsedInput: text },
        newStatus: "check_this",
      };
    }
    default: {
      return {
        section,
        fields: { unparsedInput: text },
        newStatus: "check_this",
      };
    }
  }
}
```

Remove the old `private parseServices` method — it's now in `interview-parsers.ts`.

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/interview-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): implement InterviewEngine.processResponse

Delegates to per-section parsers from interview-parsers.ts.
Returns structured fields when parsing succeeds, preserves
raw text in unparsedInput when confidence is low.
EOF
)"
```

---

## Task 4: Interview Apply Helper + TrainingShell Wiring

**Files:**

- Create: `apps/dashboard/src/lib/interview-apply.ts`
- Create: `apps/dashboard/src/lib/__tests__/interview-apply.test.ts`
- Modify: `apps/dashboard/src/components/onboarding/training-shell.tsx`

- [ ] **Step 1: Write the failing test for applyInterviewUpdate**

```typescript
// apps/dashboard/src/lib/__tests__/interview-apply.test.ts
import { describe, it, expect } from "vitest";
import { applyInterviewUpdate } from "../interview-apply";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { ResponseUpdate } from "../interview-engine";

describe("applyInterviewUpdate", () => {
  it("applies business identity fields", () => {
    const update: ResponseUpdate = {
      section: "businessIdentity",
      fields: { name: "Test Clinic" },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(createEmptyPlaybook(), update);
    expect(result.businessIdentity.name).toBe("Test Clinic");
    expect(result.businessIdentity.status).toBe("check_this");
    expect(result.businessIdentity.source).toBe("interview");
  });

  it("appends new services to existing ones", () => {
    const base = createEmptyPlaybook();
    base.services = [
      {
        id: "existing",
        name: "Existing",
        bookingBehavior: "ask_first",
        status: "ready",
        source: "manual",
      },
    ];
    const update: ResponseUpdate = {
      section: "services",
      fields: { services: [{ name: "New Service", price: 100 }] },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(base, update);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("Existing");
    expect(result.services[1].name).toBe("New Service");
    expect(result.services[1].source).toBe("interview");
  });

  it("stores unparsedInput without overwriting structured fields", () => {
    const update: ResponseUpdate = {
      section: "hours",
      fields: { unparsedInput: "Mon-Fri 9-5" },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(createEmptyPlaybook(), update);
    expect(result.hours.status).toBe("check_this");
    expect(result.hours.source).toBe("interview");
    expect(result.hours.afterHoursBehavior).toBe("");
  });

  it("does not overwrite user edits (source=manual)", () => {
    const base = createEmptyPlaybook();
    base.businessIdentity = {
      ...base.businessIdentity,
      name: "User Entered",
      status: "ready",
      source: "manual",
    };
    const update: ResponseUpdate = {
      section: "businessIdentity",
      fields: { name: "Interview Heard" },
      newStatus: "check_this",
    };
    const result = applyInterviewUpdate(base, update);
    expect(result.businessIdentity.name).toBe("User Entered");
    expect(result.businessIdentity.status).toBe("ready");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/interview-apply.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement applyInterviewUpdate**

```typescript
// apps/dashboard/src/lib/interview-apply.ts
import type { Playbook } from "@switchboard/schemas";
import type { ResponseUpdate } from "./interview-engine";

export function applyInterviewUpdate(playbook: Playbook, update: ResponseUpdate): Playbook {
  const result = structuredClone(playbook);
  const section = update.section as keyof Playbook;
  const sectionData = result[section];

  if (typeof sectionData === "object" && !Array.isArray(sectionData) && "source" in sectionData) {
    if (sectionData.source === "manual" && sectionData.status === "ready") {
      return result;
    }
  }

  if (section === "services" && update.fields.services) {
    const parsed = update.fields.services as Array<{ name: string; price?: number }>;
    const newServices = parsed.map((s) => ({
      id: crypto.randomUUID(),
      name: s.name,
      price: s.price,
      bookingBehavior: "ask_first" as const,
      status: "check_this" as const,
      source: "interview" as const,
    }));
    result.services = [...result.services, ...newServices];
    return result;
  }

  if (typeof sectionData === "object" && !Array.isArray(sectionData)) {
    const { unparsedInput: _unparsed, ...structuredFields } = update.fields;
    (result as Record<string, unknown>)[section] = {
      ...sectionData,
      ...structuredFields,
      status: update.newStatus,
      source: "interview",
    };
  }

  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/interview-apply.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into TrainingShell with dedupe guards**

In `apps/dashboard/src/components/onboarding/training-shell.tsx`:

Add imports:

```typescript
import { useEffect } from "react";
import { useWebsiteScan } from "@/hooks/use-website-scan";
import { hydratePlaybookFromScan } from "@/lib/scan-to-playbook";
import { applyInterviewUpdate } from "@/lib/interview-apply";
```

Add scan wiring with dedupe state after existing useState declarations:

```typescript
const scan = useWebsiteScan();
const [scanApplied, setScanApplied] = useState(false);

useEffect(() => {
  if (scanUrl && !scan.data && !scan.isPending && !scanApplied) {
    scan.mutate(scanUrl);
  }
}, [scanUrl]);

useEffect(() => {
  if (scan.data?.result && !scanApplied) {
    setScanApplied(true);
    const hydrated = hydratePlaybookFromScan(playbook, scan.data.result);
    onUpdatePlaybook(hydrated);
    setMessages((prev) => [
      ...prev,
      {
        id: "scan-done",
        role: "alex" as const,
        text: scan.data.result.businessName
          ? `I found ${scan.data.result.businessName.value}. I've filled in what I could — take a look at the playbook and let me know what needs fixing.`
          : "I couldn't find much on that page, but let's build your playbook together. What's your business called?",
      },
    ]);
  }
}, [scan.data, scanApplied]);
```

Replace `handleSendMessage` to use `applyInterviewUpdate`:

```typescript
const handleSendMessage = useCallback(
  (text: string) => {
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user" as const, text }]);
    setIsTyping(true);

    const currentQuestion = engine.getNextQuestion();

    setTimeout(() => {
      if (currentQuestion) {
        const update = engine.processResponse(currentQuestion, text);

        if (Object.keys(update.fields).length > 0) {
          const updated = applyInterviewUpdate(playbook, update);
          if (updated !== playbook) {
            onUpdatePlaybook(updated);
            setHighlightedSection(update.section);
            setTimeout(() => setHighlightedSection(undefined), 1500);
          }
        }
      }

      const nextQuestion = engine.getNextQuestion();
      if (nextQuestion) {
        engine.markAsked(nextQuestion.targetSection);
        setMessages((prev) => [
          ...prev,
          { id: `alex-${Date.now()}`, role: "alex" as const, text: nextQuestion.prompt },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `alex-done`,
            role: "alex" as const,
            text: "I think we've covered everything. Review the playbook on the right and make any edits you'd like. When you're happy, hit 'Try Alex' to test.",
          },
        ]);
      }
      setIsTyping(false);
    }, 800);
  },
  [engine, playbook, onUpdatePlaybook],
);
```

- [ ] **Step 6: Run training-shell tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/training-shell.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): wire scan + interview parsing into TrainingShell

Uses applyInterviewUpdate helper to keep section-specific mutation
logic out of the component. Scan wiring uses scanApplied guard to
prevent re-hydration and duplicate messages.
EOF
)"
```

---

## Task 5: Prompt Generator

**Files:**

- Create: `apps/dashboard/src/lib/prompt-generator.ts`
- Create: `apps/dashboard/src/lib/__tests__/prompt-generator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/dashboard/src/lib/__tests__/prompt-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateTestPrompts } from "../prompt-generator";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { Playbook } from "@switchboard/schemas";

const playbook: Playbook = {
  businessIdentity: {
    name: "Bright Smile",
    category: "dental",
    tagline: "",
    location: "SG",
    status: "ready",
    source: "scan",
  },
  services: [
    {
      id: "s1",
      name: "Teeth Whitening",
      price: 450,
      duration: 60,
      bookingBehavior: "ask_first",
      status: "ready",
      source: "scan",
    },
    {
      id: "s2",
      name: "Cleaning",
      price: 80,
      duration: 30,
      bookingBehavior: "book_directly",
      status: "ready",
      source: "scan",
    },
  ],
  hours: {
    timezone: "Asia/Singapore",
    schedule: { mon: "09:00-18:00", sat: "10:00-14:00" },
    afterHoursBehavior: "",
    status: "ready",
    source: "scan",
  },
  bookingRules: { leadVsBooking: "qualify first", status: "ready", source: "interview" },
  approvalMode: { bookingApproval: "ask_before_booking", status: "ready", source: "manual" },
  escalation: {
    triggers: ["refund", "complaint"],
    toneBoundaries: "",
    status: "ready",
    source: "interview",
  },
  channels: { configured: ["whatsapp"], status: "ready", source: "manual" },
};

describe("generateTestPrompts", () => {
  it("generates prompts with approved categories", () => {
    const prompts = generateTestPrompts(playbook);
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(prompts.some((p) => p.category === "BOOKING")).toBe(true);
    expect(prompts.some((p) => p.category === "PRICING")).toBe(true);
    expect(prompts.some((p) => p.category === "CHANGES")).toBe(true);
    expect(prompts.some((p) => p.category === "EDGE_CASES")).toBe(true);
  });

  it("includes a booking prompt referencing the first service", () => {
    const prompts = generateTestPrompts(playbook);
    const booking = prompts.find((p) => p.category === "BOOKING");
    expect(booking?.text).toContain("Teeth Whitening");
  });

  it("marks the first prompt as recommended", () => {
    const prompts = generateTestPrompts(playbook);
    expect(prompts[0].recommended).toBe(true);
    expect(prompts.filter((p) => p.recommended)).toHaveLength(1);
  });

  it("includes an edge-case prompt for escalation triggers", () => {
    const prompts = generateTestPrompts(playbook);
    const edgeCase = prompts.filter((p) => p.category === "EDGE_CASES");
    expect(edgeCase.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for empty playbook", () => {
    const prompts = generateTestPrompts(createEmptyPlaybook());
    expect(prompts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/prompt-generator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement prompt generator**

```typescript
// apps/dashboard/src/lib/prompt-generator.ts
import type { Playbook } from "@switchboard/schemas";
import type { TestPrompt } from "@/components/onboarding/prompt-card";

export function generateTestPrompts(playbook: Playbook): TestPrompt[] {
  const prompts: TestPrompt[] = [];

  if (playbook.services.length === 0) return prompts;

  const first = playbook.services[0];
  const second = playbook.services.length > 1 ? playbook.services[1] : null;

  prompts.push({
    id: "booking-1",
    category: "BOOKING",
    text: `I'd like to book a ${first.name} session. Do you have anything this Saturday?`,
    recommended: true,
  });

  if (first.price) {
    prompts.push({
      id: "pricing-1",
      category: "PRICING",
      text: `How much is ${first.name}?`,
      recommended: false,
    });
  }

  if (second) {
    prompts.push({
      id: "pricing-2",
      category: "PRICING",
      text: `What's the difference between ${first.name} and ${second.name}?`,
      recommended: false,
    });
  }

  prompts.push({
    id: "changes-1",
    category: "CHANGES",
    text: `I booked a ${first.name} for tomorrow but I need to reschedule. Can I move it to next week?`,
    recommended: false,
  });

  if (playbook.escalation.triggers.length > 0) {
    prompts.push({
      id: "edge-1",
      category: "EDGE_CASES",
      text: `I want a ${playbook.escalation.triggers[0]}. Who do I talk to?`,
      recommended: false,
    });
  }

  if (Object.keys(playbook.hours.schedule).length > 0) {
    prompts.push({
      id: "edge-2",
      category: "EDGE_CASES",
      text: "Are you open on Sunday? I can only come on weekends.",
      recommended: false,
    });
  }

  return prompts;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/prompt-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add TestCenter prompt generator

Generates test prompts from playbook with approved categories:
BOOKING, PRICING, CHANGES, EDGE_CASES.
EOF
)"
```

---

## Task 6: Chat Simulation Backend

**Files:**

- Create: `apps/api/src/routes/simulate-chat.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Read routes.ts to confirm registration pattern**

Already read — routes that define their own `/api/` prefix are registered without a prefix argument in `registerRoutes`.

- [ ] **Step 2: Create the simulate-chat route**

```typescript
// apps/api/src/routes/simulate-chat.ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PlaybookSchema } from "@switchboard/schemas";
import Anthropic from "@anthropic-ai/sdk";

const SimulateChatRequestSchema = z.object({
  playbook: PlaybookSchema,
  userMessage: z.string().min(1).max(2000),
});

const simulateChatRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/simulate-chat", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = SimulateChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const { playbook, userMessage } = parsed.data;
    const systemPrompt = buildAlexSystemPrompt(playbook);

    try {
      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const content = message.content[0];
      const alexMessage =
        content?.type === "text" ? content.text : "I'm not sure how to respond to that.";

      return reply.send({
        alexMessage,
        annotations: buildAnnotations(playbook, userMessage),
      });
    } catch (err) {
      app.log.warn({ err }, "Simulation failed");
      return reply.send({
        alexMessage: "Sorry, simulation is temporarily unavailable.",
        annotations: [],
      });
    }
  });
};

function buildAlexSystemPrompt(playbook: z.infer<typeof PlaybookSchema>): string {
  const parts = [
    `You are Alex, a friendly and professional AI assistant for ${playbook.businessIdentity.name || "this business"}.`,
    playbook.businessIdentity.category &&
      `The business is a ${playbook.businessIdentity.category}.`,
    playbook.businessIdentity.location && `Located in ${playbook.businessIdentity.location}.`,
  ];

  if (playbook.services.length > 0) {
    parts.push("\nServices offered:");
    for (const s of playbook.services) {
      const details = [s.name, s.price && `$${s.price}`, s.duration && `${s.duration}min`]
        .filter(Boolean)
        .join(" — ");
      parts.push(`- ${details}`);
    }
  }

  if (Object.keys(playbook.hours.schedule).length > 0) {
    parts.push("\nHours:");
    for (const [day, hours] of Object.entries(playbook.hours.schedule)) {
      parts.push(`- ${day}: ${hours}`);
    }
  }

  if (playbook.approvalMode.bookingApproval === "ask_before_booking") {
    parts.push(
      "\nWhen someone wants to book: collect their details and say you'll confirm with the owner.",
    );
  } else if (playbook.approvalMode.bookingApproval === "book_then_notify") {
    parts.push(
      "\nWhen someone wants to book: confirm the booking directly if the slot looks open.",
    );
  }

  if (playbook.escalation.triggers.length > 0) {
    parts.push(
      `\nEscalate to the owner if the conversation involves: ${playbook.escalation.triggers.join(", ")}.`,
    );
  }

  parts.push(
    "\nKeep responses concise (2-3 sentences). Be warm but professional. Never invent information not in the playbook.",
  );

  return parts.filter(Boolean).join("\n");
}

function buildAnnotations(playbook: z.infer<typeof PlaybookSchema>, userMessage: string): string[] {
  const annotations: string[] = [];
  const lower = userMessage.toLowerCase();

  if (lower.includes("book") || lower.includes("appointment") || lower.includes("schedule")) {
    annotations.push(
      `Booking mode used: ${playbook.approvalMode.bookingApproval ?? "not configured"}`,
    );
  }
  if (lower.includes("price") || lower.includes("cost") || lower.includes("how much")) {
    annotations.push(
      `Pricing mode used: ${playbook.approvalMode.pricingApproval ?? "not configured"}`,
    );
  }
  for (const trigger of playbook.escalation.triggers) {
    if (lower.includes(trigger.toLowerCase())) {
      annotations.push(`Escalation trigger matched: "${trigger}"`);
    }
  }
  if (annotations.length === 0) {
    annotations.push("Answered from playbook knowledge");
  }
  return annotations;
}

export default simulateChatRoutes;
```

- [ ] **Step 3: Register the route in routes.ts**

In `apps/api/src/bootstrap/routes.ts`, add import and registration:

```typescript
import simulateChatRoutes from "../routes/simulate-chat.js";
```

Add at the end of `registerRoutes`:

```typescript
await app.register(simulateChatRoutes);
```

- [ ] **Step 4: Verify the API compiles**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(api): add simulate-chat endpoint for TestCenter

POST /api/simulate-chat takes playbook + user message, builds
Alex system prompt, returns simulated response. Annotations
describe inputs used (booking mode, pricing mode, triggers).
EOF
)"
```

---

## Task 7: Simulation Hook + Dashboard Proxy Route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/simulate/route.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`
- Create: `apps/dashboard/src/hooks/use-simulation.ts`

- [ ] **Step 1: Add simulateChat to api-client.ts**

In `apps/dashboard/src/lib/api-client.ts`, add after the `scanWebsite` method (around line 685):

```typescript
async simulateChat(body: {
  playbook: Playbook;
  userMessage: string;
}): Promise<{ alexMessage: string; annotations: string[] }> {
  return this.request("/api/simulate-chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Create the dashboard proxy route**

```typescript
// apps/dashboard/src/app/api/dashboard/simulate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.simulateChat(body);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create the simulation hook**

```typescript
// apps/dashboard/src/hooks/use-simulation.ts
"use client";

import { useMutation } from "@tanstack/react-query";
import type { Playbook } from "@switchboard/schemas";

interface SimulateRequest {
  playbook: Playbook;
  userMessage: string;
}

interface SimulateResponse {
  alexMessage: string;
  annotations: string[];
}

async function simulateChat(req: SimulateRequest): Promise<SimulateResponse> {
  const res = await fetch("/api/dashboard/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Simulation failed");
  return res.json();
}

export function useSimulation() {
  return useMutation({ mutationFn: simulateChat });
}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add simulation hook and proxy route

Dashboard hook calls /api/dashboard/simulate (Next.js proxy),
which calls backend /api/simulate-chat via api-client.
EOF
)"
```

---

## Task 8: Wire Simulation into Onboarding Page (Step 3)

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Wire prompt generator and simulation into the page**

In `apps/dashboard/src/app/(auth)/onboarding/page.tsx`:

Add imports:

```typescript
import { generateTestPrompts } from "@/lib/prompt-generator";
import { useSimulation } from "@/hooks/use-simulation";
import type { TestPrompt } from "@/components/onboarding/prompt-card";
```

Inside the component, after existing state, add:

```typescript
const simulation = useSimulation();
const [responses, setResponses] = useState<
  Array<{
    promptId: string;
    userMessage: string;
    alexMessage: string;
    annotations: string[];
    status: "pending" | "good" | "fixed";
  }>
>([]);

const testPrompts = generateTestPrompts(playbook);

const handleSendPrompt = (prompt: TestPrompt) => {
  simulation.mutate(
    { playbook, userMessage: prompt.text },
    {
      onSuccess: (data) => {
        setResponses((prev) => [
          ...prev.filter((r) => r.promptId !== prompt.id),
          {
            promptId: prompt.id,
            userMessage: prompt.text,
            alexMessage: data.alexMessage,
            annotations: data.annotations,
            status: "pending",
          },
        ]);
      },
    },
  );
};

const handleRerunPrompt = (promptId: string) => {
  const prompt = testPrompts.find((p) => p.id === promptId);
  if (prompt) handleSendPrompt(prompt);
};
```

Replace step 3 case:

```typescript
case 3:
  return (
    <TestCenter
      prompts={testPrompts}
      onSendPrompt={handleSendPrompt}
      onRerunPrompt={handleRerunPrompt}
      onAdvance={() => handleUpdatePlaybook({ step: 4 })}
      responses={responses}
      isSimulating={simulation.isPending}
    />
  );
```

Replace step 4 case:

```typescript
case 4:
  return (
    <GoLive
      playbook={playbook}
      onLaunch={() => {
        updatePlaybook.mutate({ playbook, step: 4 });
        updateOrgConfig.mutate({ onboardingComplete: true });
      }}
      onBack={() => handleUpdatePlaybook({ step: 2 })}
      connectedChannels={[]}
      scenariosTested={responses.length}
    />
  );
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: No errors (TestCenter will need the `onRerunPrompt` prop added in Task 9)

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): wire simulation into onboarding page step 3

TestCenter receives generated prompts and real simulation responses.
Re-run replays the exact prompt by ID, not a reconstructed partial.
scenariosTested count passed to GoLive.
EOF
)"
```

---

## Task 9: TestCenter Re-run (F4) + Zero-Test Gate (F5)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/test-center.tsx`
- Modify: `apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx`:

```typescript
it("shows re-run button after response with status 'fixed'", () => {
  render(
    <TestCenter
      prompts={mockPrompts}
      onSendPrompt={vi.fn()}
      onRerunPrompt={vi.fn()}
      onAdvance={vi.fn()}
      responses={[
        {
          promptId: "p1",
          userMessage: "test",
          alexMessage: "response",
          annotations: [],
          status: "fixed",
        },
      ]}
      isSimulating={false}
    />,
  );
  expect(screen.getByText("Re-run")).toBeTruthy();
});

it("calls onRerunPrompt with promptId when re-run is clicked", () => {
  const onRerun = vi.fn();
  render(
    <TestCenter
      prompts={mockPrompts}
      onSendPrompt={vi.fn()}
      onRerunPrompt={onRerun}
      onAdvance={vi.fn()}
      responses={[
        {
          promptId: "p1",
          userMessage: "test",
          alexMessage: "response",
          annotations: [],
          status: "fixed",
        },
      ]}
      isSimulating={false}
    />,
  );
  fireEvent.click(screen.getByText("Re-run"));
  expect(onRerun).toHaveBeenCalledWith("p1");
});

it("shows zero-test confirmation when advancing with no tests", () => {
  render(
    <TestCenter
      prompts={mockPrompts}
      onSendPrompt={vi.fn()}
      onRerunPrompt={vi.fn()}
      onAdvance={vi.fn()}
      responses={[]}
      isSimulating={false}
    />,
  );
  fireEvent.click(screen.getByText(/go live/i));
  expect(screen.getByText(/haven't tested/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/test-center.test.tsx`

- [ ] **Step 3: Add onRerunPrompt prop, re-run button, and zero-test gate**

In `apps/dashboard/src/components/onboarding/test-center.tsx`:

Update the interface:

```typescript
interface TestCenterProps {
  prompts: TestPrompt[];
  onSendPrompt: (prompt: TestPrompt) => void;
  onRerunPrompt: (promptId: string) => void;
  onAdvance: () => void;
  responses: SimulatedResponse[];
  isSimulating: boolean;
}
```

Add `onRerunPrompt` to destructuring:

```typescript
export function TestCenter({
  prompts,
  onSendPrompt,
  onRerunPrompt,
  onAdvance,
  responses,
  isSimulating,
}: TestCenterProps) {
```

Add state:

```typescript
const [showZeroTestGate, setShowZeroTestGate] = useState(false);
```

In the response action buttons area (after the "Fix this" button, around line 208), add:

```typescript
{response.status === "fixed" && (
  <button
    onClick={() => onRerunPrompt(response.promptId)}
    className="text-[14px] transition-colors hover:underline"
    style={{ color: "var(--sw-text-secondary)" }}
  >
    Re-run
  </button>
)}
```

Replace the footer (around line 244-256):

```typescript
<div
  className="flex h-[64px] items-center justify-end border-t px-6"
  style={{ backgroundColor: "var(--sw-surface-raised)", borderColor: "var(--sw-border)" }}
>
  {showZeroTestGate ? (
    <div className="flex items-center gap-4">
      <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
        You haven&apos;t tested Alex yet.
      </p>
      <button
        onClick={() => setShowZeroTestGate(false)}
        className="text-[14px] font-medium"
        style={{ color: "var(--sw-accent)" }}
      >
        Test first
      </button>
      <Button
        onClick={onAdvance}
        className="h-[40px] rounded-lg px-4 text-[14px]"
        style={{ backgroundColor: "var(--sw-text-muted)", color: "white" }}
      >
        Go live anyway
      </Button>
    </div>
  ) : (
    <Button
      onClick={() => {
        if (testedCount === 0) {
          setShowZeroTestGate(true);
          return;
        }
        onAdvance();
      }}
      className="h-[48px] rounded-lg px-6 text-[16px] font-medium"
      style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
    >
      Alex is ready. Go live →
    </Button>
  )}
</div>
```

- [ ] **Step 4: Update existing tests to pass onRerunPrompt**

Add `onRerunPrompt={vi.fn()}` to all existing TestCenter renders in the test file.

- [ ] **Step 5: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/test-center.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add TestCenter re-run button and zero-test gate

Re-run calls onRerunPrompt(promptId) — parent replays the exact
original prompt. Zero-test gate persists until dismissed via
"Test first" or bypassed via "Go live anyway".
EOF
)"
```

---

## Task 10: FixThisSlideOver "Wrong Info" Path (F6)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/fix-this-slide-over.test.tsx`

> **Scope note (v1 simplification):** The approved spec targets inline section editing in the slide-over. This PR implements v1: contextual guidance showing which playbook section to edit. True inline editing is a follow-up.

- [ ] **Step 1: Write failing tests**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/fix-this-slide-over.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FixThisSlideOver } from "../fix-this-slide-over";

describe("FixThisSlideOver", () => {
  it("renders fix options when open", () => {
    render(<FixThisSlideOver isOpen={true} onClose={vi.fn()} onFix={vi.fn()} />);
    expect(screen.getByText("Wrong information")).toBeTruthy();
    expect(screen.getByText("Tone is off")).toBeTruthy();
    expect(screen.getByText("Missing context")).toBeTruthy();
  });

  it("shows section-specific guidance for wrong_info when relevantSection is provided", () => {
    render(
      <FixThisSlideOver
        isOpen={true}
        onClose={vi.fn()}
        onFix={vi.fn()}
        relevantSection="services"
      />,
    );
    fireEvent.click(screen.getByText("Wrong information"));
    expect(screen.getByText(/Services/)).toBeTruthy();
    expect(screen.getByText(/playbook/i)).toBeTruthy();
  });

  it("returns null when not open", () => {
    const { container } = render(
      <FixThisSlideOver isOpen={false} onClose={vi.fn()} onFix={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("falls back to generic prompt when no relevantSection", () => {
    render(<FixThisSlideOver isOpen={true} onClose={vi.fn()} onFix={vi.fn()} />);
    fireEvent.click(screen.getByText("Wrong information"));
    expect(screen.getByText(/incorrect/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/fix-this-slide-over.test.tsx`

- [ ] **Step 3: Add relevantSection prop**

In `apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx`:

Update interface:

```typescript
interface FixThisSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  onFix: (type: FixType, value: string) => void;
  relevantSection?: string;
}
```

Add section display names:

```typescript
const SECTION_NAMES: Record<string, string> = {
  businessIdentity: "Business Identity",
  services: "Services",
  hours: "Hours & Availability",
  bookingRules: "Booking Rules",
  approvalMode: "Approval Mode",
  escalation: "Escalation",
  channels: "Channels",
};
```

Update component signature:

```typescript
export function FixThisSlideOver({ isOpen, onClose, onFix, relevantSection }: FixThisSlideOverProps) {
```

Update the label in the selectedType branch:

```typescript
<label className="mb-2 block text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
  {selectedType === "wrong_info" && relevantSection
    ? `This answer used data from your ${SECTION_NAMES[relevantSection] ?? relevantSection} section. Edit it in your playbook to fix this, then re-run the scenario.`
    : selectedType === "tone_off"
      ? "How should Alex have said this?"
      : selectedType === "missing_context"
        ? "What should Alex know here?"
        : "What's incorrect?"}
</label>
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/fix-this-slide-over.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): FixThisSlideOver v1 contextual guidance for wrong info

When relevantSection is provided, shows which playbook section
to edit. True inline section editing is a follow-up.
EOF
)"
```

---

## Task 11: AlexChat Send Button (F7) + New Message Pill (F8)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/alex-chat.tsx`
- Modify: `apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx`:

```typescript
it("shows send button when input has text", () => {
  render(<AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={false} />);
  const input = screen.getByPlaceholderText("Type a message...");
  fireEvent.change(input, { target: { value: "Hello" } });
  expect(screen.getByTestId("send-button")).toBeTruthy();
});

it("hides send button when input is empty", () => {
  render(<AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={false} />);
  expect(screen.queryByTestId("send-button")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/alex-chat.test.tsx`

- [ ] **Step 3: Add send button and new-message pill**

In `apps/dashboard/src/components/onboarding/alex-chat.tsx`:

Add new-message pill state after existing refs:

```typescript
const [showNewMessagePill, setShowNewMessagePill] = useState(false);
const prevMessageCount = useRef(messages.length);
```

Add effect to detect new messages while scrolled up:

```typescript
useEffect(() => {
  if (messages.length > prevMessageCount.current && !isAtBottom.current) {
    setShowNewMessagePill(true);
  }
  prevMessageCount.current = messages.length;
}, [messages.length]);
```

Add scroll-to-bottom handler:

```typescript
const scrollToBottom = () => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setShowNewMessagePill(false);
  }
};
```

Update `handleScroll` to dismiss pill when at bottom:

```typescript
const handleScroll = () => {
  if (!scrollRef.current) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
  isAtBottom.current = scrollHeight - scrollTop - clientHeight < 40;
  if (isAtBottom.current) setShowNewMessagePill(false);
};
```

Wrap the scroll area in a `relative` container and add the pill. Replace the bottom input area with send button. The full render return becomes:

```typescript
return (
  <div className="flex h-full flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
    <div className="relative flex-1">
      <div ref={scrollRef} onScroll={handleScroll} className="h-full space-y-3 overflow-y-auto p-4">
        {messagesWithClusters.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isTyping && (
          <div className="flex items-center gap-2" data-testid="typing-indicator">
            <div className="shrink-0">
              <AgentMark agent="alex" size="xs" />
            </div>
            <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: "var(--sw-surface-raised)" }}>
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_0ms] rounded-full bg-[var(--sw-text-muted)]" />
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_200ms] rounded-full bg-[var(--sw-text-muted)]" />
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_400ms] rounded-full bg-[var(--sw-text-muted)]" />
              </div>
            </div>
          </div>
        )}
      </div>
      {showNewMessagePill && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1.5 text-[13px] shadow-sm"
          style={{
            backgroundColor: "var(--sw-surface-raised)",
            borderColor: "var(--sw-border)",
            color: "var(--sw-text-secondary)",
          }}
          data-testid="new-message-pill"
        >
          ↓ New message
        </button>
      )}
    </div>
    <div className="border-t p-4" style={{ borderColor: "var(--sw-border)" }}>
      <div className="relative">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-[48px] w-full rounded-lg border bg-transparent px-4 pr-12 text-[16px] outline-none transition-colors focus:border-[var(--sw-accent)]"
          style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-primary)" }}
        />
        {input.trim() && (
          <button
            onClick={handleSend}
            data-testid="send-button"
            className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity duration-150"
            style={{ color: "var(--sw-text-primary)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  </div>
);
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/alex-chat.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add AlexChat send button and new-message pill

Send arrow icon appears when text is present. New-message pill
appears when scrolled up and a new message arrives, dismisses
on scroll-to-bottom or click.
EOF
)"
```

---

## Task 12: PlaybookPanel Section-Updated Indicator (F9)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/playbook-panel.tsx`

- [ ] **Step 1: Add panel-local section-updated indicator**

In `apps/dashboard/src/components/onboarding/playbook-panel.tsx`:

Add imports:

```typescript
import { useState, useEffect, useRef } from "react";
```

Update the interface:

```typescript
interface PlaybookPanelProps {
  playbook: Playbook;
  businessName: string;
  onUpdateSection: (section: keyof Playbook, data: unknown) => void;
  onUpdateService: (service: PlaybookService) => void;
  onDeleteService: (id: string) => void;
  onAddService: () => void;
  highlightedSection?: string;
  lastUpdatedSection?: string;
}
```

Add section display name map and indicator logic inside the component:

```typescript
const SECTION_DISPLAY_NAMES: Record<string, string> = {
  businessIdentity: "Business Identity",
  services: "Services",
  hours: "Hours & Availability",
  bookingRules: "Booking Rules",
  approvalMode: "Approval Mode",
  escalation: "Escalation",
  channels: "Channels",
};

const scrollContainerRef = useRef<HTMLDivElement>(null);
const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
const [updateIndicator, setUpdateIndicator] = useState<{ key: string; label: string }>();

useEffect(() => {
  if (!lastUpdatedSection) return;
  const sectionEl = sectionRefs.current[lastUpdatedSection];
  if (!sectionEl || !scrollContainerRef.current) return;

  const container = scrollContainerRef.current;
  const rect = sectionEl.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) return;

  setUpdateIndicator({
    key: lastUpdatedSection,
    label: SECTION_DISPLAY_NAMES[lastUpdatedSection] ?? lastUpdatedSection,
  });
}, [lastUpdatedSection]);
```

Add `ref={scrollContainerRef}` to the outer scrollable div.

Wrap each `PlaybookSection` render in a ref-capturing div:

```typescript
<div ref={(el) => { sectionRefs.current["businessIdentity"] = el; }}>
  <PlaybookSection ...>...</PlaybookSection>
</div>
```

(Repeat for each section key: services, hours, bookingRules, approvalMode, escalation, channels)

Add the indicator as a panel-local element at the bottom of the scroll container (inside the `space-y-12` div, after the last section):

```typescript
{updateIndicator && (
  <div className="sticky bottom-4 flex justify-center">
    <button
      onClick={() => {
        sectionRefs.current[updateIndicator.key]?.scrollIntoView({ behavior: "smooth", block: "center" });
        setUpdateIndicator(undefined);
      }}
      className="rounded-full border px-4 py-1.5 text-[13px] shadow-sm"
      style={{
        backgroundColor: "var(--sw-surface-raised)",
        borderColor: "var(--sw-border)",
        color: "var(--sw-accent)",
      }}
    >
      ↓ {updateIndicator.label} updated
    </button>
  </div>
)}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add PlaybookPanel section-updated indicator

Panel-local sticky pill shows "↓ Section updated" when an update
arrives for a section below the viewport. Scrolls to it on click.
EOF
)"
```

---

## Task 13: Channel Icons (F10)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/channel-connect-card.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/channel-connect-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChannelConnectCard } from "../channel-connect-card";

describe("ChannelConnectCard", () => {
  it("renders channel icon for whatsapp", () => {
    render(
      <ChannelConnectCard
        channel="whatsapp" label="WhatsApp" description="Primary"
        recommended={false} isConnected={false} comingSoon={false} onConnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("channel-icon-whatsapp")).toBeTruthy();
  });

  it("renders channel icon for telegram", () => {
    render(
      <ChannelConnectCard
        channel="telegram" label="Telegram" description="Alt"
        recommended={false} isConnected={false} comingSoon={false} onConnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("channel-icon-telegram")).toBeTruthy();
  });

  it("renders channel icon for webchat", () => {
    render(
      <ChannelConnectCard
        channel="webchat" label="Web Chat" description="Website"
        recommended={false} isConnected={false} comingSoon={true} onConnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("channel-icon-webchat")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/channel-connect-card.test.tsx`

- [ ] **Step 3: Add channel icons**

In `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`, add icon map before the component:

```typescript
const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: (
    <svg data-testid="channel-icon-whatsapp" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  telegram: (
    <svg data-testid="channel-icon-telegram" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  webchat: (
    <svg data-testid="channel-icon-webchat" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};
```

In the render, wrap the label and recommended badge with the icon. Replace the existing inner `<div>` (around line 43-58):

```typescript
<div>
  <div className="flex items-center gap-2">
    <div style={{ color: "var(--sw-text-muted)", width: 20, height: 20 }}>
      {CHANNEL_ICONS[channel]}
    </div>
    <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
      {label}
    </span>
    {recommended && (
      <span
        className="rounded-full px-2 py-0.5 text-[12px]"
        style={{ color: "var(--sw-accent)", backgroundColor: "rgba(160, 120, 80, 0.1)" }}
      >
        Recommended
      </span>
    )}
  </div>
  <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
    {description}
  </p>
</div>
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/channel-connect-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add 20px monochrome channel icons

WhatsApp (message bubble), Telegram (send arrow), Web Chat
(chat bubble) icons rendered inline with channel labels.
EOF
)"
```

---

## Task 14: GoLive Hours in Summary (F11)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/go-live.tsx`
- Modify: `apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx`

- [ ] **Step 1: Write failing test**

Add to `apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx`:

```typescript
import { createEmptyPlaybook } from "@switchboard/schemas";

it("includes hours in playbook summary", () => {
  const playbook = {
    ...createEmptyPlaybook(),
    services: [
      { id: "s1", name: "Cleaning", bookingBehavior: "ask_first" as const, status: "ready" as const, source: "scan" as const },
      { id: "s2", name: "Whitening", bookingBehavior: "ask_first" as const, status: "ready" as const, source: "scan" as const },
    ],
    hours: {
      timezone: "",
      schedule: { mon: "09:00-18:00", tue: "09:00-18:00", wed: "09:00-18:00", thu: "09:00-18:00", fri: "09:00-18:00", sat: "10:00-14:00" },
      afterHoursBehavior: "",
      status: "ready" as const,
      source: "scan" as const,
    },
    approvalMode: { bookingApproval: "ask_before_booking" as const, status: "ready" as const, source: "manual" as const },
  };
  render(
    <GoLive
      playbook={playbook}
      onLaunch={vi.fn()}
      onBack={vi.fn()}
      connectedChannels={["whatsapp"]}
      scenariosTested={3}
    />,
  );
  expect(screen.getByText(/Mon-Sat/i)).toBeTruthy();
  expect(screen.getByText(/9am/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/go-live.test.tsx`

- [ ] **Step 3: Add hours to summary using explicit weekday order**

In `apps/dashboard/src/components/onboarding/go-live.tsx`, replace the `playbookSummary` construction (around line 29-35):

```typescript
const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAY_ABBRS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const hoursSummary = (() => {
  const scheduledDays = WEEKDAY_ORDER.filter((d) => d in playbook.hours.schedule);
  if (scheduledDays.length === 0) return "";

  const formatTime = (t: string) => {
    const [h, m] = t.split(":");
    const hour = parseInt(h, 10);
    const suffix = hour >= 12 ? "pm" : "am";
    const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return m === "00" ? `${display}${suffix}` : `${display}:${m}${suffix}`;
  };

  const firstHours = playbook.hours.schedule[scheduledDays[0]];
  const [open, close] = firstHours.split("-");
  const range = open && close ? `${formatTime(open)}-${formatTime(close)}` : firstHours;

  const firstAbbr = WEEKDAY_ABBRS[scheduledDays[0]];
  const lastAbbr = WEEKDAY_ABBRS[scheduledDays[scheduledDays.length - 1]];

  let contiguous = true;
  for (let i = 1; i < scheduledDays.length; i++) {
    if (
      WEEKDAY_ORDER.indexOf(scheduledDays[i]) !==
      WEEKDAY_ORDER.indexOf(scheduledDays[i - 1]) + 1
    ) {
      contiguous = false;
      break;
    }
  }

  const dayLabel =
    scheduledDays.length <= 2
      ? scheduledDays.map((d) => WEEKDAY_ABBRS[d]).join(", ")
      : contiguous
        ? `${firstAbbr}-${lastAbbr}`
        : scheduledDays.map((d) => WEEKDAY_ABBRS[d]).join(", ");

  return `${dayLabel} ${range}`;
})();

const playbookSummary = [
  `${serviceCount} service${serviceCount !== 1 ? "s" : ""}`,
  hoursSummary,
  playbook.approvalMode.bookingApproval === "ask_before_booking" ? "Approval-first" : "Auto-book",
  ...connectedChannels.map((c) => c.charAt(0).toUpperCase() + c.slice(1)),
]
  .filter(Boolean)
  .join(" · ");
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/components/onboarding/__tests__/go-live.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): include hours in GoLive playbook summary

Uses explicit weekday order array for correct day range derivation.
Shows "Mon-Sat 9am-6pm" for contiguous ranges, comma-separated
for sparse days.
EOF
)"
```

---

## Task 15: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint`
Expected: No errors

- [ ] **Step 4: Verify build**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 build`
Expected: Build succeeds
