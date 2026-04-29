import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        "border-subtle": "hsl(var(--border-subtle))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
          raised: "hsl(var(--surface-raised))",
        },
        /* Semantic */
        positive: {
          DEFAULT: "hsl(var(--positive))",
          foreground: "hsl(var(--positive-foreground))",
          subtle: "hsl(var(--positive-subtle))",
        },
        caution: {
          DEFAULT: "hsl(var(--caution))",
          foreground: "hsl(var(--caution-foreground))",
          subtle: "hsl(var(--caution-subtle))",
        },
        negative: {
          DEFAULT: "hsl(var(--negative))",
          foreground: "hsl(var(--negative-foreground))",
        },
        /* Operator amber */
        operator: {
          DEFAULT: "hsl(var(--operator))",
          foreground: "hsl(var(--operator-foreground))",
          subtle: "hsl(var(--operator-subtle))",
        },
        /* Agent status */
        agent: {
          active: "hsl(var(--agent-active))",
          idle: "hsl(var(--agent-idle))",
          attention: "hsl(var(--agent-attention))",
          locked: "hsl(var(--agent-locked))",
        },
        /* v6 landing page palette — warm cream + graphite + coral */
        v6: {
          cream: "hsl(28 30% 90%)",
          "cream-2": "hsl(32 35% 94%)",
          "cream-3": "hsl(28 28% 86%)",
          "cream-4": "hsl(28 24% 82%)",
          graphite: "hsl(20 10% 14%)",
          "graphite-2": "hsl(20 8% 38%)",
          "graphite-3": "hsl(20 6% 60%)",
          "graphite-4": "hsl(20 6% 76%)",
          coral: "hsl(14 75% 55%)",
          "coral-soft": "hsl(14 75% 55% / 0.14)",
          good: "hsl(140 38% 32%)",
          warn: "hsl(32 80% 42%)",
          dark: "hsl(20 12% 9%)",
          "on-dark": "hsl(32 30% 92%)",
          "on-dark-2": "hsl(32 14% 60%)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
        enter: "cubic-bezier(0, 0, 0.2, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        default: "280ms",
        slow: "600ms",
        "very-slow": "900ms",
      },
      keyframes: {
        "character-float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-5px)" },
        },
        "aura-breathe": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.03)", opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "v6-dot-pulse": {
          "0%, 88%, 100%": { opacity: "0", transform: "scale(0.5)" },
          "92%": { opacity: "0.55", transform: "scale(1.3)" },
          "96%": { opacity: "0", transform: "scale(1.6)" },
        },
        "v6-dash-pulse": {
          "0%, 100%": { transform: "scale(0.8)", opacity: "0.3" },
          "50%": { transform: "scale(1.6)", opacity: "0" },
        },
        "v6-nl-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(1.4)" },
        },
        "v6-pulse-soft": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(140 50% 40% / 0.35)" },
          "50%": { boxShadow: "0 0 0 8px hsl(140 50% 40% / 0)" },
        },
      },
      animation: {
        "character-float": "character-float 6s ease-in-out infinite",
        "aura-breathe": "aura-breathe 6s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.5s cubic-bezier(0, 0, 0.2, 1) forwards",
        "v6-dot-pulse": "v6-dot-pulse 6s ease-in-out infinite",
        "v6-dash-pulse": "v6-dash-pulse 2.4s ease-in-out infinite",
        "v6-nl-pulse": "v6-nl-pulse 1.6s ease-in-out infinite",
        "v6-pulse-soft": "v6-pulse-soft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
