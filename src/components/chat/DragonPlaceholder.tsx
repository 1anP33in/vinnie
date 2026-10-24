import { Logo } from "@/components/common/Logo";

/**
 * Reserved space for the interactive 3D ice dragon (Phase 5). It is clearly
 * labeled as not yet available and shows no simulated activity.
 */
export function DragonPlaceholder() {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3 text-left"
      aria-label="Dragon viewer placeholder"
    >
      <Logo size={30} className="opacity-60" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">Ice dragon viewer</div>
        <div className="text-xs text-faint">
          Planned for a future phase: an animated dragon that reacts to Vinnie's real activity.
        </div>
      </div>
    </div>
  );
}
