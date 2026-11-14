// The ice dragon companion: 3D viewer, viewer controls, and the activity
// panel. The viewer is isolated behind lazy loading and an error boundary:
// if anything in it fails, Vinnie keeps working.

import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Component, lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, IconButton } from "@/components/common/Button";
import { Logo } from "@/components/common/Logo";
import { BEHAVIOR_LABEL } from "@/dragon/behavior";
import { useCompanionStore } from "@/dragon/companionStore";
import { viewerConfigFor } from "@/dragon/viewerConfig";
import type { DragonLayout, DragonQuality, DragonSettings } from "@/lib/ipc/types";
import { DEFAULT_DRAGON_SETTINGS } from "@/settings/validation";
import { useSettingsStore } from "@/state/settingsStore";
import { DragonActivity } from "./DragonActivity";

const DragonViewer = lazy(() => import("./DragonViewer"));

class ViewerBoundary extends Component<{ children: ReactNode; onRetry(): void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm">The dragon viewer stopped working.</div>
        <div className="max-w-72 break-words font-mono text-[11px] text-faint">{this.state.error.message}</div>
        <div className="text-xs text-faint">Vinnie keeps working normally without the dragon.</div>
        <Button size="sm" icon={<RotateCcw size={13} />} onClick={this.props.onRetry}>
          Retry
        </Button>
      </div>
    );
  }
}

const motionQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      motionQuery?.addEventListener("change", cb);
      return () => motionQuery?.removeEventListener("change", cb);
    },
    () => motionQuery?.matches ?? false,
  );
}

function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-0.5" title={hint}>
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--accent-strong)]"
      />
    </label>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-2 py-1 transition-colors ${value === o.value ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DragonControls({ dragon, reduced, onChange, onResetCamera, onZoom }: {
  dragon: DragonSettings;
  reduced: boolean;
  onChange(patch: Partial<DragonSettings>): void;
  onResetCamera(): void;
  onZoom(factor: number): void;
}) {
  return (
    <div className="flex w-60 flex-col gap-2.5 text-xs" data-testid="dragon-controls">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-faint">Camera (drag to rotate, scroll to zoom)</span>
        <IconButton label="Zoom in" onClick={() => onZoom(0.85)} className="size-7">
          <ZoomIn size={13} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => onZoom(1.18)} className="size-7">
          <ZoomOut size={13} />
        </IconButton>
      </div>
      <div>
        <div className="mb-1 text-faint">Graphics quality</div>
        <Choice<DragonQuality>
          label="Graphics quality"
          value={dragon.quality}
          onChange={(quality) => onChange({ quality })}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
        />
      </div>
      <div className="flex flex-col">
        <Switch label="Snow" checked={dragon.snow} onChange={(snow) => onChange({ snow })} />
        <Switch label="Ice sparkles" checked={dragon.iceParticles} onChange={(iceParticles) => onChange({ iceParticles })} />
        <Switch label="Fog" checked={dragon.fog} onChange={(fog) => onChange({ fog })} />
        <Switch
          label="Lighting effects"
          hint="Glow, rim lights, reflections, and shadows"
          checked={dragon.lightingEffects}
          onChange={(lightingEffects) => onChange({ lightingEffects })}
        />
        <Switch label="Follow cursor" checked={dragon.followCursor} onChange={(followCursor) => onChange({ followCursor })} />
        <Switch
          label="Idle animations"
          checked={dragon.idleAnimations}
          onChange={(idleAnimations) => onChange({ idleAnimations })}
        />
      </div>
      {reduced && (
        <p className="text-faint">Reduce visual effects is on, so particles, glow, and cursor following are off.</p>
      )}
      <label className="flex flex-col gap-1">
        <span className="flex justify-between text-faint">
          Animation speed <span className="tabular-nums text-muted">{dragon.animationSpeed}%</span>
        </span>
        <input
          type="range"
          min={25}
          max={200}
          step={25}
          value={dragon.animationSpeed}
          onChange={(e) => onChange({ animationSpeed: Number(e.target.value) })}
          aria-label="Animation speed"
          className="accent-[var(--accent-strong)]"
        />
      </label>
      <div>
        <div className="mb-1 text-faint">Layout</div>
        <Choice<DragonLayout>
          label="Dragon layout"
          value={dragon.layout}
          onChange={(layout) => onChange({ layout })}
          options={[
            { value: "side", label: "Side panel" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </div>
      <Button size="sm" icon={<RotateCcw size={12} />} onClick={onResetCamera}>
        Reset camera
      </Button>
    </div>
  );
}

const clampDistance = (pct: number) => Math.round(Math.min(250, Math.max(50, pct)));

export function DragonPanel({ layout }: { layout: DragonLayout }) {
  const dragon = useSettingsStore((s) => s.settings.dragon);
  const reduceEffects = useSettingsStore((s) => s.settings.reduceEffects);
  const updateDragon = useSettingsStore((s) => s.updateDragon);
  const behavior = useCompanionStore((s) => s.behavior);
  const reaction = useCompanionStore((s) => s.reaction);
  const prefersReduced = usePrefersReducedMotion();
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [viewerAttempt, setViewerAttempt] = useState(0);

  const reduced = reduceEffects || prefersReduced;
  const config = useMemo(() => viewerConfigFor(dragon, reduced), [dragon, reduced]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const zoom = (factor: number) =>
    updateDragon({ camera: { ...dragon.camera, distancePct: clampDistance(dragon.camera.distancePct * factor) } });
  const resetCamera = () => updateDragon({ camera: { ...DEFAULT_DRAGON_SETTINGS.camera } });
  const compact = layout === "compact" && !fullscreen;

  return (
    <section
      aria-label="Ice dragon companion"
      data-testid="dragon-panel"
      data-layout={layout}
      className={`flex min-h-0 flex-col bg-bg ${
        fullscreen ? "fixed inset-0 z-50" : compact ? "h-56 shrink-0 border-b border-border" : "h-full border-l border-border"
      }`}
    >
      <header className="flex h-9 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border px-2">
        <Logo size={14} className="opacity-80" />
        <span className="ml-1 text-xs font-medium">Vinnie</span>
        <span className="ml-1 min-w-0 truncate text-[11px] text-faint" aria-live="polite">
          {BEHAVIOR_LABEL[behavior]}
        </span>
        <span className="flex-1" />
        <IconButton label="Reset camera" onClick={resetCamera} className="size-7">
          <RotateCcw size={13} />
        </IconButton>
        <IconButton
          label={dragon.idleAnimations ? "Pause idle animations" : "Resume idle animations"}
          onClick={() => updateDragon({ idleAnimations: !dragon.idleAnimations })}
          className="size-7"
        >
          {dragon.idleAnimations ? <Pause size={13} /> : <Play size={13} />}
        </IconButton>
        <IconButton label="Viewer settings" active={controlsOpen} onClick={() => setControlsOpen((v) => !v)} className="size-7">
          <SlidersHorizontal size={13} />
        </IconButton>
        <IconButton
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={() => setFullscreen((v) => !v)}
          className="size-7"
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </IconButton>
        <IconButton
          label="Hide the dragon"
          onClick={() => {
            setFullscreen(false);
            updateDragon({ panelOpen: false });
          }}
          className="size-7"
        >
          <X size={13} />
        </IconButton>
      </header>

      <div className={`flex min-h-0 flex-1 ${compact ? "flex-row" : "flex-col"}`}>
        <div className={`dragon-stage relative min-h-0 ${compact ? "w-1/2 min-w-40" : "flex-1"}`}>
          <ViewerBoundary key={viewerAttempt} onRetry={() => setViewerAttempt((a) => a + 1)}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Logo size={34} className="dragon-breathe opacity-80" />
                </div>
              }
            >
              <DragonViewer
                config={config}
                behavior={behavior}
                reaction={reaction}
                onCameraChange={(camera) => updateDragon({ camera })}
              />
            </Suspense>
          </ViewerBoundary>
          {controlsOpen && (
            <div className="absolute right-2 top-2 z-10 rounded-lg border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur">
              <DragonControls
                dragon={dragon}
                reduced={reduced}
                onChange={updateDragon}
                onResetCamera={resetCamera}
                onZoom={zoom}
              />
            </div>
          )}
        </div>
        <div
          className={`min-h-0 overflow-y-auto ${compact ? "w-1/2 border-l border-border" : "max-h-[45%] shrink-0 border-t border-border"}`}
        >
          <DragonActivity compact={compact} />
        </div>
      </div>
    </section>
  );
}
