"use client";

import { useEffect, useRef, useState } from "react";

interface UseScrollRevealOptions {
  threshold?: number;
  once?: boolean;
}

export function useScrollReveal({ threshold = 0.2, once = true }: UseScrollRevealOptions = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.disconnect();
        }
      },
      { threshold },
    );

    const el = ref.current;
    if (el) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [threshold, once]);

  return { ref, isVisible };
}
