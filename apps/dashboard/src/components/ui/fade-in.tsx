"use client";

import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function FadeIn({ children, delay = 0, className }: FadeInProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15, once: true });

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 380ms ease-out ${delay}ms, transform 380ms ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
