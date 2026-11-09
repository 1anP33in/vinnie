// Composer button: choose skills for this session (Auto / On / Off).

import { BookOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSkillStore } from "@/state/skillStore";

export function SkillPicker() {
  const skills = useSkillStore((s) => s.skills);
  const overrides = useSkillStore((s) => s.overrides);
  const setOverride = useSkillStore((s) => s.setOverride);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const forced = Object.values(overrides).filter((v) => v === "on").length;
  const usable = skills.filter((s) => s.enabled && !s.error);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (usable.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Skills for this session"
        aria-expanded={open}
        title="Skills: Vinnie picks relevant ones automatically; you can force one on or off"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text ${forced ? "text-accent" : ""}`}
      >
        <BookOpen size={15} />
        {forced > 0 && <span className="absolute right-1 top-1 rounded-full bg-accent px-1 text-[9px] leading-tight text-accent-fg">{forced}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Skills for this session" className="absolute bottom-11 right-0 z-20 w-80 rounded-xl border border-border-strong bg-surface p-2 shadow-glow">
          <p className="px-2 pb-1.5 text-[11px] text-faint">Auto lets Vinnie choose by your request and project. These choices last until Vinnie restarts.</p>
          <ul className="max-h-72 overflow-y-auto">
            {usable.map((s) => {
              const value = overrides[s.id] ?? null;
              return (
                <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-xs" title={s.description}>
                    {s.name}
                  </span>
                  <div role="radiogroup" aria-label={`${s.name} for this session`} className="inline-flex rounded-md border border-border bg-bg p-0.5 text-[10px]">
                    {([null, "on", "off"] as const).map((v) => (
                      <button
                        key={v ?? "auto"}
                        type="button"
                        role="radio"
                        aria-checked={value === v}
                        onClick={() => setOverride(s.id, v)}
                        className={`rounded px-1.5 py-0.5 ${value === v ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
                      >
                        {v === null ? "Auto" : v === "on" ? "On" : "Off"}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
