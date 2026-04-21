"use client";

import { useEffect, useState } from "react";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  translateY?: number;
  style?: React.CSSProperties;
}

export function FadeIn({ children, delay = 0, className, translateY = 16, style }: FadeInProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15, once: true });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const show = isVisible || reducedMotion;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : `translateY(${translateY}px)`,
        transition: reducedMotion
          ? "none"
          : `opacity 380ms ease-out ${delay}ms, transform 380ms ease-out ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
