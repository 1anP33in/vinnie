// Target postures for each dragon behavior. The animation manager eases the
// rig toward these values; angles are radians and kept small so the model's
// anatomy is never pushed past what the rig was built for.

import type { DragonBehavior } from "../behavior";

export interface PoseTarget {
  /** Head nod; positive raises the snout. Applied to the head bone. */
  headPitch: number;
  /** Raise or lower the whole neck; spread across neck_01–04. */
  neckRaise: number;
  /** 0 = wings spread (rest pose), 1 = folded along the back. Capped at 0.9. */
  wingFold: number;
  /** Small rhythmic wing lift amplitude. */
  wingFlutter: number;
  /** Tail sway amplitude and speed. */
  tailAmp: number;
  tailSpeed: number;
  /** Tail held higher (+) or lower (−). */
  tailLift: number;
  /** Breathing clip speed multiplier. */
  breath: number;
  /** Cyan glow intensity, 0–1. */
  glow: number;
  /** How much the dragon glances around on its own, 0–1+. */
  lookAround: number;
  /** How strongly it turns to look at the viewer (the user), 0–1. */
  lookAtUser: number;
  /** Jaw opening. */
  jaw: number;
}

export const MAX_WING_FOLD = 0.9;

const REST: PoseTarget = {
  headPitch: 0,
  neckRaise: 0,
  wingFold: 0.82,
  wingFlutter: 0,
  tailAmp: 0.06,
  tailSpeed: 0.6,
  tailLift: 0,
  breath: 1,
  glow: 0.15,
  lookAround: 1,
  lookAtUser: 0,
  jaw: 0,
};

export const POSES: Record<DragonBehavior, PoseTarget> = {
  idle: REST,
  thinking: { ...REST, headPitch: -0.06, neckRaise: 0.05, wingFold: 0.8, tailAmp: 0.05, tailSpeed: 0.9, breath: 1.1, glow: 0.7, lookAround: 0.55 },
  planning: { ...REST, headPitch: 0.1, neckRaise: 0.16, wingFold: 0.7, tailAmp: 0.07, tailSpeed: 0.8, breath: 1.1, glow: 0.5, lookAround: 1.3 },
  executing: { ...REST, headPitch: -0.1, neckRaise: 0.1, wingFold: 0.6, wingFlutter: 0.05, tailAmp: 0.1, tailSpeed: 1.4, breath: 1.25, glow: 0.6, lookAround: 0.2 },
  waiting: { ...REST, headPitch: 0.05, neckRaise: 0.12, wingFold: 0.75, tailAmp: 0.03, tailSpeed: 0.5, breath: 0.9, glow: 0.35, lookAround: 0, lookAtUser: 1 },
  verifying: { ...REST, headPitch: -0.14, neckRaise: 0.06, wingFold: 0.7, tailAmp: 0.05, tailSpeed: 0.9, breath: 1.05, glow: 0.55, lookAround: 0.9 },
  paused: { ...REST, neckRaise: 0.05, wingFold: 0.8, tailAmp: 0.03, tailSpeed: 0.4, breath: 0.9, glow: 0.2, lookAround: 0.2, lookAtUser: 0.5 },
  completed: { ...REST, headPitch: 0.18, neckRaise: 0.14, wingFold: 0.45, wingFlutter: 0.04, tailAmp: 0.12, tailSpeed: 1.0, tailLift: 0.05, breath: 0.9, glow: 0.4, lookAround: 0.3, lookAtUser: 0.4, jaw: 0.06 },
  failed: { ...REST, headPitch: -0.32, neckRaise: -0.18, wingFold: MAX_WING_FOLD, tailAmp: 0.02, tailSpeed: 0.4, tailLift: -0.08, breath: 0.8, glow: 0.05, lookAround: 0 },
  cancelled: { ...REST, lookAround: 0.3 },
};

/** Ease rates (per second) for each parameter; larger is snappier. */
export const EASE_RATE: Record<keyof PoseTarget, number> = {
  headPitch: 2.2,
  neckRaise: 1.8,
  wingFold: 1.1,
  wingFlutter: 2,
  tailAmp: 1.5,
  tailSpeed: 1.5,
  tailLift: 1.5,
  breath: 1.5,
  glow: 2.5,
  lookAround: 1.5,
  lookAtUser: 2.5,
  jaw: 3,
};

/** Frame-rate independent exponential approach. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function easePose(current: PoseTarget, target: PoseTarget, dt: number): PoseTarget {
  const next = { ...current };
  for (const key of Object.keys(EASE_RATE) as (keyof PoseTarget)[]) {
    next[key] = approach(current[key], target[key], EASE_RATE[key], dt);
  }
  return next;
}

/**
 * With idle animations paused, the resting dragon holds still: no glancing,
 * no tail sway. Task postures still change so the state stays readable.
 */
export function withIdlePaused(pose: PoseTarget): PoseTarget {
  return { ...pose, lookAround: 0, tailAmp: 0, wingFlutter: 0 };
}
