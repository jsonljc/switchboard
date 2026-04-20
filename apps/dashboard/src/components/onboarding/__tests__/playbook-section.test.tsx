import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaybookSection } from "../playbook-section";

describe("PlaybookSection", () => {
  it("renders section title and status", () => {
    render(
      <PlaybookSection title="Services" status="ready" required>
        <p>Content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("renders missing status", () => {
    render(
      <PlaybookSection title="Hours" status="missing" required>
        <p>Content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  it("renders check_this status", () => {
    render(
      <PlaybookSection title="Business" status="check_this" required>
        <p>Content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Check this")).toBeTruthy();
  });

  it("collapses and expands on header click", () => {
    render(
      <PlaybookSection title="Services" status="ready" required>
        <p>Section content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Section content")).toBeTruthy();
    fireEvent.click(screen.getByText("Services"));
    expect(screen.queryByText("Section content")).toBeNull();
    fireEvent.click(screen.getByText("Services"));
    expect(screen.getByText("Section content")).toBeTruthy();
  });

  it("starts collapsed when defaultCollapsed is true", () => {
    render(
      <PlaybookSection title="Hours" status="missing" required defaultCollapsed>
        <p>Hidden content</p>
      </PlaybookSection>,
    );
    expect(screen.queryByText("Hidden content")).toBeNull();
  });
});
