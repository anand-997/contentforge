import type { Config } from "tailwindcss";

/**
 * QA Walah brand tokens mirror contentforge.config.json -> brand.imageColors
 * so the dashboard reads as one identity with the generated image cards.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand surface ramp (deep dark -> elevated panels)
        ink: {
          900: "#080b10",
          800: "#0d1117",
          700: "#11161f",
          600: "#161c27",
          500: "#1d2533",
          400: "#283143",
        },
        // Primary accent (teal) and secondary (amber)
        teal: {
          DEFAULT: "#00d4aa",
          soft: "#1de9b6",
          dim: "#0b7c66",
        },
        amber: {
          DEFAULT: "#f0a500",
          soft: "#ffc23d",
        },
        subtext: "#8b949e",
        hairline: "rgba(255,255,255,0.08)",
        // Status palette
        status: {
          pending: "#8b949e",
          writing: "#3b82f6",
          imaging: "#f0a500",
          done: "#00d4aa",
          error: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0,212,170,0.25), 0 8px 40px -12px rgba(0,212,170,0.35)",
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 40px -16px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        "teal-radial":
          "radial-gradient(60% 60% at 50% 0%, rgba(0,212,170,0.12) 0%, rgba(0,212,170,0) 70%)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "loading-bar": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        "fade-up": "fade-up 0.3s ease-out both",
        shimmer: "shimmer 1.5s infinite",
        "loading-bar": "loading-bar 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
