import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";

interface ResizerProps {
  axis: "x" | "y";
  /** Current value (px). The resizer is otherwise stateless — parent owns the size. */
  value: number;
  /** Receives the next clamped value as the user drags. */
  onChange: (next: number) => void;
  /** If true, dragging in the negative direction grows the value (e.g. right-pane handle). */
  invert?: boolean;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Thin draggable separator. Uses pointer events + setPointerCapture so the
 * drag still tracks when the cursor leaves the handle, and applies a
 * document-wide cursor + select:none class while dragging to avoid the OS
 * I-beam stealing focus mid-drag.
 */
export function Resizer({
  axis,
  value,
  onChange,
  invert = false,
  min = 120,
  max = 1200,
  className,
  ariaLabel,
}: ResizerProps) {
  const drag = useRef<{ startVal: number; startPos: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startVal: value,
      startPos: axis === "x" ? e.clientX : e.clientY,
    };
    document.body.classList.add(
      axis === "x" ? "cursor-col-resize" : "cursor-row-resize",
      "select-none",
    );
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const cur = axis === "x" ? e.clientX : e.clientY;
    const delta = (cur - drag.current.startPos) * (invert ? -1 : 1);
    const next = Math.min(max, Math.max(min, drag.current.startVal + delta));
    onChange(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
    document.body.classList.remove(
      "cursor-col-resize",
      "cursor-row-resize",
      "select-none",
    );
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={ariaLabel}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "group relative shrink-0 bg-transparent touch-none",
        axis === "x"
          ? "w-1.5 cursor-col-resize border-x border-border-subtle"
          : "h-1.5 cursor-row-resize border-y border-border-subtle",
        className,
      )}
    >
      {/* Visible indicator line, brighter on hover/drag. */}
      <span
        className={cn(
          "pointer-events-none absolute bg-border-subtle transition-colors",
          "group-hover:bg-accent/70 group-active:bg-accent",
          axis === "x"
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}
