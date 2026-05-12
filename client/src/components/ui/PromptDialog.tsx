import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
  /** Return an error string to reject, or null/undefined to accept. */
  validate?: (value: string) => string | null | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  defaultValue = "",
  submitLabel = "OK",
  cancelLabel = "Cancel",
  validate,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setError(null);
      // Focus the input after Dialog mounts.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open, defaultValue]);

  const submit = () => {
    const v = value.trim();
    if (!v) {
      setError("Please enter a value.");
      return;
    }
    const err = validate?.(v);
    if (err) {
      setError(err);
      return;
    }
    onSubmit(v);
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {label ? (
          <span className="block text-xs font-medium text-fg-muted">{label}</span>
        ) : null}
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
        />
        {error ? (
          <div className="rounded border border-danger/30 bg-danger-subtle px-2 py-1 text-[11px] text-danger">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
