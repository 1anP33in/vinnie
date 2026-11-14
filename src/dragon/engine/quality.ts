// Graphics presets for the dragon viewer. Medium is the default: it stays
// smooth on integrated GPUs while keeping shadows and particles.

import type { DragonQuality } from "@/lib/ipc/types";

export interface QualityPreset {
  /** Upper bound for the canvas pixel ratio. */
  maxPixelRatio: number;
  /** Frame-rate cap while the viewer is visible. */
  fps: number;
  antialias: boolean;
  /** Shadow map size; 0 disables shadows. */
  shadowMapSize: number;
  snowCount: number;
  iceCount: number;
  /** Real mirror reflection on the floor (renders the scene twice). */
  reflections: boolean;
  /** Glass-like transmission on the ice crystals (an extra render pass). */
  transmission: boolean;
}

export const QUALITY_PRESETS: Record<DragonQuality, QualityPreset> = {
  low: {
    maxPixelRatio: 1,
    fps: 30,
    antialias: false,
    shadowMapSize: 0,
    snowCount: 120,
    iceCount: 6,
    reflections: false,
    transmission: false,
  },
  medium: {
    maxPixelRatio: 1.25,
    fps: 45,
    antialias: true,
    shadowMapSize: 1024,
    snowCount: 380,
    iceCount: 14,
    reflections: false,
    transmission: false,
  },
  high: {
    maxPixelRatio: 2,
    fps: 60,
    antialias: true,
    shadowMapSize: 2048,
    snowCount: 900,
    iceCount: 28,
    reflections: true,
    transmission: true,
  },
};

/** While the dragon is resting, render less often; motion is slow anyway. */
export const IDLE_FPS_FACTOR = 0.67;
