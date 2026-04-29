"use client";

import { createElement, useEffect, useRef, useState } from "react";

interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  as?: React.ElementType;
  className?: string;
}

/** Wraps content in a v6-reveal element that fades+rises into view on scroll. */
export function Reveal({ children, as = "div", className = "", ...rest }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [isIn, setIsIn] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setIsIn(true);
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" },
    );
    io.observe(node);

    // Fallback: anything already on screen at mount should reveal immediately.
    const r = node.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) setIsIn(true);

    return () => io.disconnect();
  }, []);

  return createElement(
    as,
    {
      ref,
      className: `v6-reveal ${isIn ? "in" : ""} ${className}`,
      ...rest,
    },
    children,
  );
}
