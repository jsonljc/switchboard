import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
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
      },
      animation: {
        "character-float": "character-float 6s ease-in-out infinite",
        "aura-breathe": "aura-breathe 6s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.5s cubic-bezier(0, 0, 0.2, 1) forwards",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
