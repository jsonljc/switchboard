"use client";

import { useState } from "react";

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionProps {
  items: FaqItem[];
}

export function FaqAccordion({ items }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map(({ question, answer }, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={question}
            style={{
              borderBottom: "1px solid #DDD9D3",
            }}
          >
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1.25rem 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
              aria-expanded={isOpen}
            >
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  color: "#1A1714",
                  letterSpacing: "-0.01em",
                }}
              >
                {question}
              </span>
              <span
                style={{
                  fontSize: "1.25rem",
                  color: "#9C958F",
                  transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                  transition: "transform 200ms ease",
                  flexShrink: 0,
                  marginLeft: "1rem",
                }}
              >
                +
              </span>
            </button>
            <div
              style={{
                overflow: "hidden",
                maxHeight: isOpen ? "10rem" : "0",
                opacity: isOpen ? 1 : 0,
                transition: "max-height 300ms ease, opacity 200ms ease",
              }}
              aria-hidden={!isOpen}
            >
              <p
                style={{
                  fontSize: "0.9375rem",
                  lineHeight: 1.65,
                  color: "#6B6560",
                  paddingBottom: "1.25rem",
                }}
              >
                {answer}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
