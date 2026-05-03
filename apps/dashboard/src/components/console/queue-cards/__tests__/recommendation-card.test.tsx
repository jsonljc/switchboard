import { fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ToastProvider } from "../../use-toast";
import { ToastShelf } from "../../toast-shelf";
import { RecommendationCardView } from "../recommendation-card";
import type { RecommendationCard } from "../../console-data";

const card: RecommendationCard = {
  kind: "recommendation",
  id: "card-r1",
  agent: "nova",
  action: "Pause Whitening Ad Set B",
  timer: { label: "Immediate", confidence: "0.87" },
  dataLines: [["spend $42 last 24h"]],
  primary: { label: "Pause" },
  secondary: { label: "Reduce 50%" },
  dismiss: { label: "Dismiss" },
};

function wrap(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      {ui}
      <ToastShelf />
    </ToastProvider>,
  );
}

describe("RecommendationCardView", () => {
  it("primary fires non-undoable toast and onResolve", () => {
    const onResolve = vi.fn();
    wrap(<RecommendationCardView card={card} resolving={false} onResolve={onResolve} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".btn-primary-graphite")!);
    expect(onResolve).toHaveBeenCalled();
    const toast = document.querySelector(".toast");
    expect(toast).not.toBeNull();
    expect(toast!.querySelector(".undo")).toBeNull();
  });

  it("secondary fires non-undoable toast and onResolve", () => {
    const onResolve = vi.fn();
    wrap(<RecommendationCardView card={card} resolving={false} onResolve={onResolve} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".btn-ghost")!);
    expect(onResolve).toHaveBeenCalled();
  });

  it("dismiss fires non-undoable toast and onResolve", () => {
    const onResolve = vi.fn();
    wrap(<RecommendationCardView card={card} resolving={false} onResolve={onResolve} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".btn-text")!);
    expect(onResolve).toHaveBeenCalled();
  });

  it("renders id=q-${card.id}", () => {
    wrap(<RecommendationCardView card={card} resolving={false} onResolve={vi.fn()} />);
    expect(document.querySelector("#q-card-r1")).not.toBeNull();
  });

  it("applies is-resolving class when resolving=true", () => {
    wrap(<RecommendationCardView card={card} resolving={true} onResolve={vi.fn()} />);
    expect(document.querySelector(".qcard")?.classList.contains("is-resolving")).toBe(true);
  });
});
