import type { Config } from "tailwindcss";

const c = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tokens are sourced from CSS variables in globals.css. Light is the
        // default; html[data-theme="dark"] overrides everything.
        bg: {
          DEFAULT: c("bg"),
          subtle: c("bg-subtle"),
          muted: c("bg-muted"),
          elevated: c("bg-elevated"),
        },
        border: {
          DEFAULT: c("border"),
          subtle: c("border-subtle"),
          strong: c("border-strong"),
        },
        fg: {
          DEFAULT: c("fg"),
          muted: c("fg-muted"),
          subtle: c("fg-subtle"),
          inverse: c("fg-inverse"),
        },
        accent: {
          DEFAULT: c("accent"),
          hover: c("accent-hover"),
          subtle: c("accent-subtle"),
        },
        success: { DEFAULT: c("success"), subtle: c("success-subtle") },
        warning: { DEFAULT: c("warning"), subtle: c("warning-subtle") },
        danger: { DEFAULT: c("danger"), subtle: c("danger-subtle") },
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
          "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 18px 40px rgba(3,10,14,0.18), 0 0 0 1px rgba(11,17,20,0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
