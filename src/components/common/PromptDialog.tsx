import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

/** Small modal asking for one line of text (file names, paths). */
export function PromptDialog({
  open,
  title,
  label,
  initialValue = "",
  confirmLabel,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  error?: string | null;
  onConfirm(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setValue(initialValue);
  }

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    input?.focus();
    // Select the file name without its extension, like most editors.
    const dot = initialValue.lastIndexOf(".");
    const slash = initialValue.lastIndexOf("/");
    input?.setSelectionRange(slash + 1, dot > slash + 1 ? dot : initialValue.length);
  }, [open, initialValue]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        className="w-full max-w-md rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onConfirm(value.trim());
        }}
      >
        <h2 id="prompt-title" className="text-base font-semibold">
          {title}
        </h2>
        <label className="mt-3 block text-xs text-muted" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          spellCheck={false}
          className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-accent"
        />
        {error && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
