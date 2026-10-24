import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

export function CopyButton({
  text,
  label = "Copy",
  showLabel = false,
  className = "",
}: {
  text: string | (() => string);
  label?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = async () => {
    const ok = await copyText(typeof text === "function" ? text() : text);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };

  const current = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={current}
      title={current}
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface-3 hover:text-text ${className}`}
    >
      {state === "copied" ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      {showLabel && <span>{current}</span>}
    </button>
  );
}
