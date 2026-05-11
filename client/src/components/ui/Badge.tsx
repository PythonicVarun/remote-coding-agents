import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const tones: Record<Tone, string> = {
  neutral: "bg-bg-muted text-fg-muted border-border",
  accent: "bg-accent-subtle text-accent-hover border-accent/30",
  success: "bg-success-subtle text-success border-success/30",
  warning: "bg-warning-subtle text-warning border-warning/30",
  danger: "bg-danger-subtle text-danger border-danger/40",
};

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
