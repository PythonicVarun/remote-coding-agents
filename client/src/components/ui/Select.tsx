import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-9 w-full rounded-md bg-bg-elevated border border-border px-3 text-sm",
          "text-fg",
          "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
          "disabled:opacity-50 transition-colors",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    );
  },
);
