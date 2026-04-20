"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneScreenChoose } from "./phone-screen-choose";
import { PhoneScreenConnect } from "./phone-screen-connect";
import { PhoneScreenTrust } from "./phone-screen-trust";

const STEPS = [
  {
    label: "01 — Choose",
    heading: "Start with the outcome you need.",
    body: "Lead qualification, appointment booking, or follow-up recovery. Pick the first workflow you want handled and deploy it in minutes.",
  },
  {
    label: "02 — Connect",
    heading: "Go live on the channels your customers already use.",
    body: "Connect WhatsApp, Telegram, or add a widget to your site. Once connected, your agent can start replying immediately.",
  },
  {
    label: "03 — Trust",
    heading: "Starts supervised. Earns speed.",
    body: "Every action begins with your approval. As your agent proves itself, you can review less and move faster — without giving up control.",
  },
];

const PHONE_SCREENS = [PhoneScreenChoose, PhoneScreenConnect, PhoneScreenTrust];

function PhoneFrame({ activeStep }: { activeStep: number }) {
  return (
    <div
      style={{
        width: "280px",
        aspectRatio: "9 / 16",
        background: "#FFFFFF",
        borderRadius: "2rem",
        border: "1px solid #DDD9D3",
        boxShadow: "0 8px 32px rgba(26,23,20,0.08)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #EDEAE5",
          background: "#F9F8F6",
        }}
      >
        <p
          style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#9C958F", textAlign: "center" }}
        >
          Switchboard
        </p>
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStep}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {(() => {
              const Screen = PHONE_SCREENS[activeStep];
              return <Screen />;
            })()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function ScrollytellingSection() {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setPrefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const observers: IntersectionObserver[] = [];

    stepRefs.current.forEach((el, index) => {
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveStep(index);
          }
        },
        { threshold: 0.6 },
      );
      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [prefersReducedMotion]);

  return (
    <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width">
        {/* Mobile: sticky phone at top */}
        <div
          className="lg:hidden"
          style={{
            position: "sticky",
            top: "5rem",
            zIndex: 10,
            display: "flex",
            justifyContent: "center",
            paddingBottom: "2rem",
          }}
        >
          <PhoneFrame activeStep={activeStep} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto]" style={{ gap: "4rem" }}>
          {/* Left: scrolling steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8rem" }}>
            {STEPS.map((step, i) => (
              <div key={step.label}>
                <div
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  style={{ minHeight: "16rem" }}
                >
                  <p
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "#A07850",
                      marginBottom: "1rem",
                    }}
                  >
                    {step.label}
                  </p>
                  <h3
                    style={{
                      fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#1A1714",
                      marginBottom: "1rem",
                    }}
                  >
                    {step.heading}
                  </h3>
                  <p
                    style={{
                      fontSize: "1rem",
                      lineHeight: 1.65,
                      color: "#6B6560",
                      maxWidth: "40ch",
                    }}
                  >
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Right: sticky phone (desktop only) */}
          <div
            className="hidden lg:block"
            style={{
              position: "sticky",
              top: "8rem",
              alignSelf: "start",
            }}
          >
            <PhoneFrame activeStep={activeStep} />
          </div>
        </div>

        {/* Closing line */}
        <p
          style={{
            marginTop: "4rem",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#6B6560",
            textAlign: "center",
          }}
        >
          From setup to first live lead conversation: minutes, not days.
        </p>
      </div>
    </section>
  );
}
