// Synthetic MediaPipe-pose swing fixtures for the analysis tests.
//
// A real swing's mid-wrist height traces low (address) → high (top) → low
// (impact) → high (finish); MediaPipe y grows downward, so that's large → small
// → large → small. We lerp each joint across the four phase frames so the whole
// analysis pipeline (detectPhases → computeMetrics → computeSpeed → faults) runs
// on data shaped like the real thing, and head/hip drift is tunable to make a
// fault fire on demand.
import type { LM, Phases } from "@/lib/analysis";

const N_LM = 33;
const NOSE = 0;
const L_SH = 11, R_SH = 12;
const L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24;
const L_ANK = 27, R_ANK = 28;

type XY = [number, number];
type XYZ = [number, number, number];
export type JointMap = Record<number, XY | XYZ>;

export function makeFrame(joints: JointMap): LM[] {
  const lm: LM[] = new Array(N_LM);
  for (let j = 0; j < N_LM; j++) {
    const v = joints[j];
    lm[j] = v
      ? { x: v[0], y: v[1], z: v[2] ?? 0, visibility: 1 }
      : { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  }
  return lm;
}

export type SwingOpts = {
  fps?: number;
  phases?: Phases;
  n?: number;
  /** how far the nose wanders sideways by the top (drives head sway %) */
  noseDriftX?: number;
  /** how far the nose lifts/dips by impact (drives head vertical %) */
  noseDriftY?: number;
  /** lateral hip slide toward the target by impact */
  hipDriftX?: number;
  view?: "face-on" | "down-the-line";
  /** make every frame null (no pose) — for the "nothing detected" paths */
  blank?: boolean;
  /** add a MediaPipe-z coil to shoulders + hips so the kinematic-sequence /
   *  x-factor path (which needs real rotation) actually runs */
  depth?: boolean;
};

const DEFAULT_PHASES: Phases = { address: 6, top: 24, impact: 30, finish: 40 };

// Piecewise-linear sample of a per-phase scalar across all n frames, flat outside.
function across(ph: Phases, val: Record<keyof Phases, number>, n: number): number[] {
  const idx = [ph.address, ph.top, ph.impact, ph.finish];
  const v = [val.address, val.top, val.impact, val.finish];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (i <= idx[0]) out[i] = v[0];
    else if (i >= idx[3]) out[i] = v[3];
    else {
      let k = 0;
      while (k < 2 && i > idx[k + 1]) k++;
      const f = (i - idx[k]) / (idx[k + 1] - idx[k]);
      out[i] = v[k] + f * (v[k + 1] - v[k]);
    }
  }
  return out;
}

export function buildSwing(opts: SwingOpts = {}) {
  const fps = opts.fps ?? 30;
  const ph = opts.phases ?? DEFAULT_PHASES;
  const n = opts.n ?? ph.finish + 6;
  const shW = opts.view === "down-the-line" ? 0.04 : 0.2;
  const hipW = opts.view === "down-the-line" ? 0.05 : 0.16;
  const dX = opts.noseDriftX ?? 0;
  const dY = opts.noseDriftY ?? 0;
  const hipD = opts.hipDriftX ?? 0.02;

  // mid-wrist height per phase: low / high / low / high.
  const wy = across(ph, { address: 0.72, top: 0.26, impact: 0.72, finish: 0.2 }, n);
  const nx = across(ph, { address: 0.5, top: 0.5 + dX, impact: 0.5, finish: 0.5 }, n);
  const ny = across(ph, { address: 0.2, top: 0.2, impact: 0.2 + dY, finish: 0.18 }, n);
  const hx = across(ph, { address: 0.5, top: 0.5, impact: 0.5 + hipD, finish: 0.5 + hipD * 1.5 }, n);

  // Rotation coil (degrees): shoulders coil ~45° to the top then unwind through;
  // hips coil less (~28°) and unwind a touch slower, so x-factor exists at the top
  // and the pelvis/torso angular-speed peaks lead the hands' peak.
  const shRot = opts.depth ? across(ph, { address: 0, top: 45, impact: -10, finish: -30 }, n) : null;
  const hipRot = opts.depth ? across(ph, { address: 0, top: 28, impact: -16, finish: -28 }, n) : null;
  // Encode rotation θ as a z-split across the pair so atan2(zR−zL, xR−xL) === θ.
  const zSplit = (rotDeg: number, widthX: number) => (widthX * Math.tan((rotDeg * Math.PI) / 180)) / 2;

  const frames = [];
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    times.push(i / fps);
    if (opts.blank) {
      frames.push(null);
      continue;
    }
    const shZ = shRot ? zSplit(shRot[i], shW) : 0;
    const hipZ = hipRot ? zSplit(hipRot[i], hipW) : 0;
    frames.push(
      makeFrame({
        [NOSE]: [nx[i], ny[i]],
        [L_SH]: [0.5 - shW / 2, 0.4, -shZ],
        [R_SH]: [0.5 + shW / 2, 0.4, shZ],
        [L_WRIST]: [0.48, wy[i]],
        [R_WRIST]: [0.52, wy[i]],
        [L_HIP]: [hx[i] - hipW / 2, 0.62, -hipZ],
        [R_HIP]: [hx[i] + hipW / 2, 0.62, hipZ],
        [L_ANK]: [0.42, 0.95],
        [R_ANK]: [0.58, 0.95],
      })
    );
  }
  return { frames, times, fps, phases: ph, n };
}

// A clip with no swing in it: hands hang at address height the whole time.
export function buildStill(n = 40, fps = 30) {
  const frames = [];
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    times.push(i / fps);
    frames.push(
      makeFrame({
        [NOSE]: [0.5, 0.2],
        [L_SH]: [0.4, 0.4],
        [R_SH]: [0.6, 0.4],
        [L_WRIST]: [0.48, 0.72],
        [R_WRIST]: [0.52, 0.72],
        [L_HIP]: [0.43, 0.62],
        [R_HIP]: [0.57, 0.62],
        [L_ANK]: [0.42, 0.95],
        [R_ANK]: [0.58, 0.95],
      })
    );
  }
  return { frames, times, fps, n };
}
