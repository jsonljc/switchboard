"use client";

import { useEffect } from "react";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function ambientHsl(hour: number): string {
  const day = { h: 40, s: 25, l: 94 };
  const dawn = { h: 45, s: 15, l: 96 };
  const dusk = { h: 35, s: 30, l: 92 };
  const night = { h: 30, s: 25, l: 91 };
  const mix = (A: typeof day, B: typeof day, t: number) => ({
    h: lerp(A.h, B.h, t),
    s: lerp(A.s, B.s, t),
    l: lerp(A.l, B.l, t),
  });
  let c;
  if (hour >= 5 && hour < 8) c = mix(dawn, day, (hour - 5) / 3);
  else if (hour >= 8 && hour < 17) c = day;
  else if (hour >= 17 && hour < 20) c = mix(day, dusk, (hour - 17) / 3);
  else if (hour >= 20 && hour < 24) c = mix(dusk, night, (hour - 20) / 4);
  else c = night;
  return `hsl(${c.h.toFixed(1)} ${c.s.toFixed(1)}% ${c.l.toFixed(1)}%)`;
}

export function AmbientCream() {
  useEffect(() => {
    function apply() {
      const now = new Date();
      const h = now.getHours() + now.getMinutes() / 60;
      document.documentElement.style.setProperty("--ambient-cream", ambientHsl(h));
    }
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
