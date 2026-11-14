import { Logo } from "@/components/common/Logo";
import { useSettingsStore } from "@/state/settingsStore";

/** Welcome-screen shortcut back to the dragon when its panel is hidden. */
export function DragonInvite() {
  const enabled = useSettingsStore((s) => s.settings.dragon.enabled);
  const open = useSettingsStore((s) => s.settings.dragon.panelOpen);
  const updateDragon = useSettingsStore((s) => s.updateDragon);
  if (!enabled || open) return null;
  return (
    <button
      type="button"
      onClick={() => updateDragon({ panelOpen: true })}
      className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <Logo size={30} className="opacity-80" />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted">Show the ice dragon</span>
        <span className="block text-xs text-faint">Vinnie's companion, reacting to what the agent is doing.</span>
      </span>
    </button>
  );
}
