import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Professional dark slate palette with a single accent.
        bg: {
          DEFAULT: "#0b0d12",
          subtle: "#11141b",
          muted: "#161a23",
          elevated: "#1c2230",
        },
        border: {
          DEFAULT: "#262d3d",
          subtle: "#1d2330",
          strong: "#384055",
        },
        fg: {
          DEFAULT: "#e6e9f0",
          muted: "#9aa3b6",
          subtle: "#6b748a",
          inverse: "#0b0d12",
        },
        accent: {
          DEFAULT: "#6366f1",
          hover: "#7b7ef0",
          subtle: "#1f2240",
        },
        success: { DEFAULT: "#22c55e", subtle: "#0e2419" },
        warning: { DEFAULT: "#f59e0b", subtle: "#2a1d05" },
        danger: { DEFAULT: "#ef4444", subtle: "#2a1010" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "Menlo", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 0 0 1px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
} satisfies Config;
