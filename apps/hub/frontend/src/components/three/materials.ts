import * as THREE from "three";

// The textures and the three chassis colours, shared by every scene.
//
// Built once, lazily, and reused. A canvas texture is cheap to make and free to
// reuse; making one per lamp would be neither, and the topology scene places
// several machines at once, so a per-instance texture would multiply the upload
// by however many boxes are on screen.

let glowTex: THREE.CanvasTexture | null = null;
let shadowTex: THREE.CanvasTexture | null = null;
let meshTex: THREE.CanvasTexture | null = null;

export const CHASSIS = "#2c2f36";
export const CHASSIS_DARK = "#1a1c21";
export const PANEL = "#16181c";

export function radial(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function glow(): THREE.CanvasTexture {
  glowTex ??= radial("rgba(255,255,255,1)", "rgba(255,255,255,0)");
  return glowTex;
}

export function shadow(): THREE.CanvasTexture {
  shadowTex ??= radial("rgba(0,0,0,0.55)", "rgba(0,0,0,0)", 256);
  return shadowTex;
}

/** The perforated panel, as one repeating texture rather than a few hundred
 *  little cylinders.
 *
 *  `repeat` lives on the texture, so two machines sharing this one cannot ask
 *  for different tilings. They do not need to: it is cloned per user below. */
export function meshPattern(): THREE.CanvasTexture {
  if (!meshTex) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3a3d44";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#111318";
    ctx.beginPath();
    ctx.arc(8, 8, 3.2, 0, Math.PI * 2);
    ctx.fill();
    meshTex = new THREE.CanvasTexture(canvas);
    meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
    meshTex.colorSpace = THREE.SRGBColorSpace;
  }
  return meshTex;
}

/** A view of the perforation at one tiling.
 *
 *  Sharing the base texture was fine when one machine was on screen; the
 *  topology scene draws the mini PC and the NAS together, and they want 14x and
 *  10x. A clone shares the uploaded image and carries its own transform, which
 *  is the cheap half of the trade. */
export function tiled(repeat: number): THREE.CanvasTexture {
  const tex = meshPattern().clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}
