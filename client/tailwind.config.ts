import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Professional graphite palette with a restrained blue accent.
        bg: {
          DEFAULT: "#0b1114",
          subtle: "#10181d",
          muted: "#172127",
          elevated: "#1d2930",
        },
        border: {
          DEFAULT: "#27343d",
          subtle: "#1d2a32",
          strong: "#40535f",
        },
        fg: {
          DEFAULT: "#e8eef2",
          muted: "#a5b2bc",
          subtle: "#74838f",
          inverse: "#0b1114",
        },
        accent: {
          DEFAULT: "#2f7cf6",
          hover: "#5a98f7",
          subtle: "#12233f",
        },
        success: { DEFAULT: "#31c48d", subtle: "#0e261f" },
        warning: { DEFAULT: "#f2b84b", subtle: "#2a210b" },
        danger: { DEFAULT: "#f36d6d", subtle: "#311516" },
      },
      fontFamily: {
        sans: [
          "Aptos",
          "\"Segoe UI Variable\"",
          "\"IBM Plex Sans\"",
          "\"Segoe UI\"",
          "\"Helvetica Neue\"",
          "sans-serif",
        ],
        mono: ["\"JetBrains Mono\"", "\"Cascadia Code\"", "Consolas", "Menlo", "monospace"],
      },
      boxShadow: {
        panel:
          "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 18px 40px rgba(3,10,14,0.32), 0 0 0 1px rgba(11,17,20,0.55)",
      },
    },
  },
  plugins: [],
} satisfies Config;
