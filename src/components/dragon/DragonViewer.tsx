// The 3D viewer host. Loaded lazily (with three.js) so the rest of Vinnie
// never waits for, or depends on, the dragon.

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Logo } from "@/components/common/Logo";
import type { DragonBehavior } from "@/dragon/behavior";
import type { CompanionState } from "@/dragon/companionStore";
import { DragonController, type ViewerConfig, type ViewerStatus } from "@/dragon/engine/controller";
import { clearDragonModelCache } from "@/dragon/engine/model";
import type { DragonCamera } from "@/lib/ipc/types";

export interface DragonViewerProps {
  config: ViewerConfig;
  behavior: DragonBehavior;
  reaction: CompanionState["reaction"];
  onCameraChange(camera: DragonCamera): void;
}

export default function DragonViewer(props: DragonViewerProps) {
  const [attempt, setAttempt] = useState(0);
  // Quality and lighting change the renderer itself, so they rebuild it.
  const key = `${props.config.quality}:${props.config.lightingEffects}:${attempt}`;
  return (
    <ViewerInstance
      key={key}
      {...props}
      onRetry={() => {
        clearDragonModelCache();
        setAttempt((a) => a + 1);
      }}
      onRebuild={() => setAttempt((a) => a + 1)}
    />
  );
}

function ViewerInstance({
  config,
  behavior,
  reaction,
  onCameraChange,
  onRetry,
  onRebuild,
}: DragonViewerProps & { onRetry(): void; onRebuild(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<DragonController | null>(null);
  const [status, setStatus] = useState<ViewerStatus>({ phase: "loading" });
  const [showWarnings, setShowWarnings] = useState(false);
  const latest = useRef({ config, behavior, onCameraChange, onRebuild });
  useLayoutEffect(() => {
    latest.current = { config, behavior, onCameraChange, onRebuild };
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const c = new DragonController(el, latest.current.config, {
      onStatus: (next) => {
        // After a context restore, start over with a fresh renderer (the model stays cached).
        if (next.phase === "restored") latest.current.onRebuild();
        else setStatus(next);
      },
      onCameraChange: (cam) => latest.current.onCameraChange(cam),
    });
    c.setBehavior(latest.current.behavior);
    controller.current = c;
    void c.start();
    // Stop rendering while the panel is scrolled or collapsed out of view.
    const io = new IntersectionObserver(([entry]) => c.setVisible(!!entry && entry.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      c.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => controller.current?.setConfig(config), [config]);
  useEffect(() => controller.current?.setBehavior(behavior), [behavior]);
  useEffect(() => {
    if (reaction) controller.current?.react(reaction.kind);
  }, [reaction]);

  const warnings = status.phase === "ready" ? status.warnings : [];

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="dragon-viewer" data-phase={status.phase}>
      <div ref={host} className="absolute inset-0" />

      {status.phase === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-faint">
          <Logo size={34} className="dragon-breathe opacity-80" />
          Waking the dragon…
        </div>
      )}

      {status.phase === "context-lost" && (
        <div className="absolute inset-x-3 top-3 rounded-md border border-warning/40 bg-surface/90 px-3 py-2 text-xs text-warning">
          The graphics context was interrupted. Restoring…
        </div>
      )}

      {status.phase === "error" && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={22} className="text-warning" />
          <div className="max-w-72 text-sm text-text">{status.message}</div>
          {status.detail && <div className="max-w-72 break-words font-mono text-[11px] text-faint">{status.detail}</div>}
          <div className="text-xs text-faint">Vinnie keeps working normally without the dragon.</div>
          <Button size="sm" icon={<RotateCcw size={13} />} onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]">
          <button
            type="button"
            onClick={() => setShowWarnings((v) => !v)}
            className="flex items-center gap-1 rounded-md bg-surface/80 px-2 py-1 text-[11px] text-warning"
          >
            <AlertTriangle size={11} /> Model issues ({warnings.length})
          </button>
          {showWarnings && (
            <ul className="mt-1 rounded-md border border-border bg-surface/95 p-2 text-[11px] text-muted">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
