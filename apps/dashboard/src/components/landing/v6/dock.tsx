"use client";

import { useEffect, useState } from "react";
import { ArrowSig } from "./glyphs";

const TARGETS = ["alex", "how", "pricing"] as const;
type Target = (typeof TARGETS)[number];

export function V6Dock() {
  const [show, setShow] = useState(false);
  const [active, setActive] = useState<Target | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const past = y > window.innerHeight * 0.7;

      const footer = document.querySelector("footer[data-screen-label]");
      const footerTop = footer
        ? (footer as HTMLElement).getBoundingClientRect().top
        : Number.POSITIVE_INFINITY;
      const nearFooter = footerTop < window.innerHeight - 80;
      setShow(past && !nearFooter);

      let nextActive: Target | null = null;
      for (const id of TARGETS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.3) {
          nextActive = id;
        }
      }
      setActive(nextActive);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      id="dock"
      aria-label="Floating navigation"
      className={`fixed bottom-7 left-1/2 z-[60] inline-flex items-center gap-1 rounded-full bg-v6-graphite py-[0.4rem] pl-[0.9rem] pr-[0.4rem] text-v6-on-dark shadow-[0_12px_40px_hsl(20_12%_4%_/_0.25),0_2px_6px_hsl(20_12%_4%_/_0.12)] transition-[opacity,transform] duration-[350ms] ${
        show
          ? "translate-x-[-50%] translate-y-0 opacity-100"
          : "pointer-events-none translate-x-[-50%] translate-y-5 opacity-0"
      }`}
    >
      <span aria-hidden="true" className="flex h-[18px] w-[18px] items-center justify-center">
        <span className="v6-dock-dot relative h-[0.55rem] w-[0.55rem] rounded-full bg-v6-cream" />
      </span>
      <span
        aria-hidden="true"
        className="mx-[0.35rem] h-[14px] w-px bg-[hsl(32_14%_60%_/_0.25)] max-[640px]:hidden"
      />

      <DockLink href="#alex" target="alex" active={active === "alex"}>
        The desk
      </DockLink>
      <DockLink href="#how" target="how" active={active === "how"}>
        How it works
      </DockLink>
      <DockLink href="#pricing" target="pricing" active={active === "pricing"}>
        Pricing
      </DockLink>

      <a
        href="#closer"
        className="ml-1 inline-flex items-center gap-[0.45rem] rounded-full bg-v6-cream px-4 py-[0.55rem] text-[0.8125rem] font-medium text-v6-graphite transition-transform duration-200 hover:-translate-y-px hover:text-v6-graphite"
      >
        Hire <ArrowSig className="!h-[0.55rem] !w-[0.85rem]" />
      </a>
    </nav>
  );
}

function DockLink({
  href,
  target,
  active,
  children,
}: {
  href: string;
  target: Target;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      data-target={target}
      className={`v6-dock-link inline-flex items-center gap-[0.4rem] rounded-full px-[0.9rem] py-[0.55rem] text-[0.8125rem] font-medium transition-colors duration-200 max-[640px]:hidden ${
        active
          ? "active text-v6-on-dark"
          : "text-v6-on-dark-2 hover:bg-[hsl(32_14%_60%_/_0.08)] hover:text-v6-on-dark"
      }`}
    >
      {children}
    </a>
  );
}
