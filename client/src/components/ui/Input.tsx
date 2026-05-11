import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-md bg-bg-elevated border border-border px-3 text-sm",
          "text-fg placeholder:text-fg-subtle",
          "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
          "disabled:opacity-50 transition-colors",
          className,
        )}
        {...rest}
      />
    );
  },
);
