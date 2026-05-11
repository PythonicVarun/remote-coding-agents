import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover active:bg-accent disabled:opacity-50 disabled:hover:bg-accent",
  secondary:
    "bg-bg-elevated text-fg border border-border hover:border-border-strong hover:bg-bg-muted disabled:opacity-50",
  ghost:
    "bg-transparent text-fg-muted hover:text-fg hover:bg-bg-muted disabled:opacity-40",
  danger:
    "bg-danger/90 text-white hover:bg-danger disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
});
