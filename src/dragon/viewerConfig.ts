import type { DragonSettings } from "@/lib/ipc/types";
import type { ViewerConfig } from "./engine/controller";

/** Settings → what the renderer gets. "Reduce visual effects" also quiets the dragon. */
export function viewerConfigFor(d: DragonSettings, reduce: boolean): ViewerConfig {
  return {
    quality: d.quality,
    snow: d.snow && !reduce,
    iceParticles: d.iceParticles && !reduce,
    fog: d.fog,
    lightingEffects: d.lightingEffects && !reduce,
    animationSpeed: d.animationSpeed,
    idleAnimations: d.idleAnimations,
    followCursor: d.followCursor && !reduce,
    camera: d.camera,
  };
}
