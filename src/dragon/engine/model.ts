// Loading and checking the dragon model. The GLB is loaded once per app run
// and reused when the viewer reopens; failures are not cached, so Retry works.

import { PropertyBinding, type AnimationClip, type Material, type Mesh, type Object3D, type Texture } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export const DRAGON_MODEL_PATH = "models/vinnie_dragon.glb";

export function dragonModelUrl(): string {
  return `${import.meta.env.BASE_URL ?? "/"}${DRAGON_MODEL_PATH}`;
}

/** Bone names as authored in Blender. GLTFLoader strips "." from node names. */
export function boneName(blenderName: string): string {
  return PropertyBinding.sanitizeNodeName(blenderName);
}

export const NECK_BONES = ["neck_01", "neck_02", "neck_03", "neck_04"].map(boneName);
export const TAIL_BONES = Array.from({ length: 8 }, (_, i) => boneName(`tail_0${i + 1}`));
export const EYELID_BONES = ["eyelid_upper.L", "eyelid_upper.R", "eyelid_lower.L", "eyelid_lower.R"].map(boneName);
export const WING_UPPER = { L: boneName("wing_upper.L"), R: boneName("wing_upper.R") };
export const HEAD = boneName("head");
export const JAW = boneName("jaw");
export const CHEST = boneName("chest");

/** Bones the procedural animation drives. Without them it is skipped, not faked. */
export const REQUIRED_BONES = [HEAD, JAW, CHEST, ...NECK_BONES, ...TAIL_BONES, WING_UPPER.L, WING_UPPER.R];

export const CLIP = { idle: "Idle_Breathe", blink: "Blink", wingsFold: "Wings_Fold" } as const;
export const EXPECTED_CLIPS: string[] = Object.values(CLIP);

/** Texture maps each textured material is exported with. */
export const EXPECTED_MAPS: Record<string, (keyof TexturedMaterial)[]> = {
  M_Dragon_Scales: ["map", "normalMap", "roughnessMap", "emissiveMap"],
  M_Dragon_Belly: ["map", "normalMap", "roughnessMap"],
  M_Dragon_Horns: ["map", "normalMap", "roughnessMap", "emissiveMap"],
  M_Dragon_Claws: ["map", "normalMap", "roughnessMap"],
  M_Dragon_Wing_Membrane: ["map", "normalMap", "roughnessMap", "emissiveMap"],
  M_Dragon_Eye: ["map", "emissiveMap"],
};

interface TexturedMaterial {
  map: Texture | null;
  normalMap: Texture | null;
  roughnessMap: Texture | null;
  emissiveMap: Texture | null;
}

export type DragonLoadErrorKind = "missing" | "invalid" | "network";

export class DragonLoadError extends Error {
  constructor(
    readonly kind: DragonLoadErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DragonLoadError";
  }
}

export interface ModelReport {
  meshes: number;
  skinnedMeshes: number;
  bones: number;
  materials: string[];
  clips: string[];
  missingBones: string[];
  missingClips: string[];
  /** "Material: map" entries for textures the export should contain but doesn't. */
  missingTextures: string[];
}

/** Check a loaded dragon for the parts the viewer relies on. Pure; no WebGL. */
export function inspectDragon(root: Object3D, clips: AnimationClip[]): ModelReport {
  const boneNames = new Set<string>();
  const materials = new Map<string, Material>();
  let meshes = 0;
  let skinnedMeshes = 0;
  root.traverse((o) => {
    if ((o as { isBone?: boolean }).isBone) boneNames.add(o.name);
    const mesh = o as Mesh & { isSkinnedMesh?: boolean };
    if (mesh.isMesh) {
      meshes++;
      if (mesh.isSkinnedMesh) skinnedMeshes++;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m) materials.set(m.name, m);
      }
    }
  });
  const missingTextures: string[] = [];
  for (const [name, maps] of Object.entries(EXPECTED_MAPS)) {
    const material = materials.get(name) as (Material & Partial<TexturedMaterial>) | undefined;
    if (!material) continue;
    for (const map of maps) if (!material[map]) missingTextures.push(`${name}: ${map}`);
  }
  const clipNames = clips.map((c) => c.name);
  return {
    meshes,
    skinnedMeshes,
    bones: boneNames.size,
    materials: [...materials.keys()].sort(),
    clips: clipNames,
    missingBones: REQUIRED_BONES.filter((b) => !boneNames.has(b)),
    missingClips: EXPECTED_CLIPS.filter((c) => !clipNames.includes(c)),
    missingTextures,
  };
}

/** Human-readable problems to show next to the viewer (empty when all is well). */
export function reportWarnings(report: ModelReport): string[] {
  const warnings: string[] = [];
  if (report.missingTextures.length) {
    warnings.push(`Missing textures: ${report.missingTextures.join(", ")}. Those surfaces use flat colors.`);
  }
  if (report.missingClips.length) {
    warnings.push(`Missing animation clips: ${report.missingClips.join(", ")}. Matching motions are disabled.`);
  }
  if (report.missingBones.length) {
    warnings.push(`Missing rig bones: ${report.missingBones.join(", ")}. Procedural motion for them is disabled.`);
  }
  return warnings;
}

let cached: Promise<GLTF> | null = null;

async function fetchAndParse(url: string): Promise<GLTF> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new DragonLoadError("network", `Couldn't read the dragon model (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!response.ok) {
    throw new DragonLoadError(
      response.status === 404 ? "missing" : "network",
      response.status === 404
        ? `The dragon model file is missing (${DRAGON_MODEL_PATH}).`
        : `Couldn't read the dragon model (HTTP ${response.status}).`,
    );
  }
  const data = await response.arrayBuffer();
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  try {
    const gltf = await new GLTFLoader().parseAsync(data, base);
    if (!gltf.scene) throw new Error("no scene");
    return gltf;
  } catch (err) {
    throw new DragonLoadError(
      "invalid",
      `The dragon model couldn't be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Load (or reuse) the dragon. */
export function loadDragonModel(url: string = dragonModelUrl()): Promise<GLTF> {
  if (!cached) {
    cached = fetchAndParse(url).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

/** For tests and after the model file changes. */
export function clearDragonModelCache(): void {
  cached = null;
}
