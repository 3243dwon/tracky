// Faithful TypeScript port of the Python swing-cv analysis
// (swing_phases.py detect_phases + analyze.py analyze/flag_faults/watch_notes).
// All math runs on normalized MediaPipe Pose landmarks (x,y in 0..1).

export type LM = { x: number; y: number; z?: number; visibility?: number };
export type Frame = LM[] | null;

export const NOSE = 0;
export const L_WRIST = 15, R_WRIST = 16;
export const L_SH = 11, R_SH = 12;
export const L_HIP = 23, R_HIP = 24;
export const L_ANK = 27, R_ANK = 28;

export const PHASES = ["address", "top", "impact", "finish"] as const;
export type PhaseName = (typeof PHASES)[number];
export type Phases = Record<PhaseName, number>;

export type Metrics = {
  view: "face-on" | "down-the-line";
  tempoRatio: number;
  backswingS: number;
  downswingS: number;
  headSwayPct: number;
  headVertPct: number;
  hipSwayBackPct: number;
  hipSlideImpactPct: number;
  spineAddrDeg: number;
  spineTopDeg: number;
  spineImpactDeg: number;
  reverseSpineDeg: number;
  secondaryTiltDeg: number;
};

export type Fault = { title: string; mishit: string; detail: string; focus: string };

// Hand (mid-wrist) speed over the swing, in body-heights per second.
// Multiply by (standing height in m × 0.89) for m/s — nose-to-ankle ≈ 0.89 × stature.
export type SpeedAnalysis = {
  t: number[];
  v: number[];
  peak: number;
  peakT: number;
  impact: number;
};

export type SequencePeak = { name: "pelvis" | "torso" | "hands"; t: number; msBeforeImpact: number };

// Kinematic-sequence approximation from single-camera depth estimates.
// Order and timing are indicative; magnitudes are rough.
export type SequenceAnalysis = {
  t: number[];
  pelvis: number[]; // angular speed toward the target, deg/s
  torso: number[];
  hands: number[]; // body-heights/s (same series as SpeedAnalysis.v)
  peaks: SequencePeak[];
  textbook: boolean;
};

export type XFactor = { topDeg: number; peakDeg: number; peakT: number; stretchPct: number };

export type Quality = { ok: boolean; reason?: string };

export type Analysis = {
  phases: Phases;
  times: Record<PhaseName, number>;
  metrics: Metrics;
  faults: Fault[];
  notes: string[];
  detectedPct: number;
  fps: number;
  speed: SpeedAnalysis | null;
  sequence: SequenceAnalysis | null;
  xfactor: XFactor | null;
  quality: Quality;
};

function smooth(x: number[], k = 5): number[] {
  const n = x.length;
  if (n < 3) return x.slice();
  const half = Math.floor(k / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j < Math.min(n, i + half + 1); j++) { s += x[j]; c++; }
    out[i] = s / c;
  }
  return out;
}

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function argmin(a: number[]): number { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[b]) b = i; return b; }
function argmax(a: number[]): number { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }

function sign(v: number): string { return (v >= 0 ? "+" : "") + v.toFixed(0); }

function mid(lm: LM[], i: number, j: number): [number, number] {
  return [(lm[i].x + lm[j].x) / 2, (lm[i].y + lm[j].y) / 2];
}

function tiltDeg(low: [number, number], high: [number, number]): number {
  const vx = high[0] - low[0], vy = high[1] - low[1];
  return (Math.atan2(vx, -vy) * 180) / Math.PI;
}

function bodyHeight(lm: LM[]): number {
  const ax = (lm[L_ANK].x + lm[R_ANK].x) / 2, ay = (lm[L_ANK].y + lm[R_ANK].y) / 2;
  return Math.hypot(lm[NOSE].x - ax, lm[NOSE].y - ay) || 0.1;
}

function nearest(frames: Frame[], i: number): LM[] {
  if (frames[i]) return frames[i]!;
  for (let d = 1; d < frames.length; d++) {
    if (frames[i - d]) return frames[i - d]!;
    if (frames[i + d]) return frames[i + d]!;
  }
  throw new Error("No pose detected in any frame.");
}

export function detectPhases(frames: Frame[]): Phases {
  const n = frames.length;
  if (n < 8) throw new Error("Clip too short — film a full swing (a couple of seconds).");

  const hy = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f) hy[i] = (f[L_WRIST].y + f[R_WRIST].y) / 2;
  }
  const good: number[] = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(hy[i])) good.push(i);
  if (good.length < 6) throw new Error("Couldn't track your body — try a clearer, brighter clip with your full body in frame.");

  // linear interpolation over gaps
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(hy[i])) {
      let lo = -1, hi = -1;
      for (const g of good) { if (g <= i) lo = g; }
      for (const g of good) { if (g >= i) { hi = g; break; } }
      if (lo === -1) hy[i] = hy[hi];
      else if (hi === -1) hy[i] = hy[lo];
      else if (lo === hi) hy[i] = hy[lo];
      else hy[i] = hy[lo] + ((hy[hi] - hy[lo]) * (i - lo)) / (hi - lo);
    }
  }

  const s = smooth(hy, 5);
  const base = median(s.slice(0, Math.max(3, Math.floor(n / 5))));
  const amp = base - Math.min(...s);
  const thr = base - 0.25 * amp;

  const localMin: number[] = [];
  for (let i = 1; i < n - 1; i++) if (s[i] <= s[i - 1] && s[i] < s[i + 1]) localMin.push(i);

  let top = localMin.find((i) => s[i] < thr);
  if (top === undefined) top = argmin(s);
  const finish = top + 1 + argmin(s.slice(top + 1));
  const impact = top + argmax(s.slice(top, finish + 1));
  const address = argmax(s.slice(0, top + 1));
  return { address, top, impact, finish };
}

export function computeMetrics(frames: Frame[], phases: Phases, fps: number): Metrics {
  const a = nearest(frames, phases.address);
  const t = nearest(frames, phases.top);
  const im = nearest(frames, phases.impact);
  const f = nearest(frames, phases.finish);

  const scale = bodyHeight(a);
  const hipA = mid(a, L_HIP, R_HIP), hipF = mid(f, L_HIP, R_HIP);
  const tgt = hipF[0] - hipA[0] >= 0 ? 1 : -1;
  const swAddr = Math.abs(a[L_SH].x - a[R_SH].x);
  const view: Metrics["view"] = swAddr / scale > 0.15 ? "face-on" : "down-the-line";

  const spine = (fr: LM[]) => tiltDeg(mid(fr, L_HIP, R_HIP), mid(fr, L_SH, R_SH)) * tgt;
  const spineAddr = spine(a), spineTop = spine(t), spineImpact = spine(im);

  const hipx = (fr: LM[]) => mid(fr, L_HIP, R_HIP)[0];
  const hipSwayBack = ((hipx(t) - hipx(a)) * tgt) / scale * 100;
  const hipSlideImpact = ((hipx(im) - hipx(a)) * tgt) / scale * 100;

  const noseA = a[NOSE];
  const dxs: number[] = [], dys: number[] = [];
  for (let i = phases.address; i <= phases.impact; i++) {
    const fr = frames[i];
    if (!fr) continue;
    dxs.push(fr[NOSE].x - noseA.x);
    dys.push(fr[NOSE].y - noseA.y);
  }
  const range = (arr: number[]) => (arr.length ? Math.max(...arr) - Math.min(...arr) : 0);
  const headSway = (range(dxs) / scale) * 100;
  const headVert = (range(dys) / scale) * 100;

  const backS = (phases.top - phases.address) / fps;
  const downS = (phases.impact - phases.top) / fps;

  return {
    view,
    tempoRatio: downS > 0 ? backS / downS : NaN,
    backswingS: backS,
    downswingS: downS,
    headSwayPct: headSway,
    headVertPct: headVert,
    hipSwayBackPct: hipSwayBack,
    hipSlideImpactPct: hipSlideImpact,
    spineAddrDeg: spineAddr,
    spineTopDeg: spineTop,
    spineImpactDeg: spineImpact,
    reverseSpineDeg: spineTop - spineAddr,
    secondaryTiltDeg: spineAddr - spineImpact,
  };
}

export function flagFaults(m: Metrics): Fault[] {
  const f: Fault[] = [];
  if (m.headSwayPct > 15 || Math.abs(m.hipSwayBackPct) > 18)
    f.push({
      title: "Excess lateral sway",
      mishit: "fat & thin shots — the low point wanders, so strike is hit-or-miss",
      detail: `head ${m.headSwayPct.toFixed(0)}% / hip ${sign(m.hipSwayBackPct)}% of body height`,
      focus: "strike consistency",
    });
  if (m.headVertPct > 12)
    f.push({
      title: "Head lifts or dips through the swing",
      mishit: "topped and thin shots — the killers off the tee and fairway",
      detail: `${m.headVertPct.toFixed(0)}% of body height vertically`,
      focus: "strike consistency",
    });
  if (!Number.isNaN(m.tempoRatio) && m.tempoRatio < 1.8)
    f.push({
      title: "Rushed transition",
      mishit: "loss of sequence → inconsistent contact and direction",
      detail: `tempo ${m.tempoRatio.toFixed(1)}:1 (smooth is ~3:1)`,
      focus: "tempo",
    });
  return f;
}

export function watchNotes(m: Metrics): string[] {
  const notes: string[] = [];
  if (Math.abs(m.secondaryTiltDeg) > 15)
    notes.push(
      `Spine angle changes ${sign(m.secondaryTiltDeg)}° from address to impact — if you filmed down-the-line, a big stand-up can mean early extension (thins/shanks). Confirm with a clean DTL clip.`
    );
  if (m.reverseSpineDeg > 10)
    notes.push(
      `Upper body may lean toward the target at the top (~${m.reverseSpineDeg.toFixed(0)}°) — possible reverse pivot; confirm on a DTL clip.`
    );
  return notes;
}

// Linear interpolation over NaN gaps (two-pointer, O(n)).
function interpNaN(a: number[]): number[] {
  const n = a.length;
  const out = a.slice();
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(out[i])) continue;
    if (prev === -1 && i > 0) for (let j = 0; j < i; j++) out[j] = out[i];
    else if (prev >= 0 && i - prev > 1)
      for (let j = prev + 1; j < i; j++) out[j] = out[prev] + ((out[i] - out[prev]) * (j - prev)) / (i - prev);
    prev = i;
  }
  if (prev >= 0) for (let j = prev + 1; j < n; j++) out[j] = out[prev];
  return out;
}

export function computeSpeed(frames: Frame[], times: number[], phases: Phases): SpeedAnalysis | null {
  const n = frames.length;
  if (n < 7 || times.length !== n) return null;
  const scale = bodyHeight(nearest(frames, phases.address));
  const xs = new Array<number>(n).fill(NaN);
  const ys = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f) {
      xs[i] = (f[L_WRIST].x + f[R_WRIST].x) / 2;
      ys[i] = (f[L_WRIST].y + f[R_WRIST].y) / 2;
    }
  }
  const px = smooth(interpNaN(xs), 3);
  const py = smooth(interpNaN(ys), 3);
  const v = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const dt = times[i + 1] - times[i - 1];
    if (dt > 0) v[i] = Math.hypot(px[i + 1] - px[i - 1], py[i + 1] - py[i - 1]) / dt / scale;
  }
  v[0] = v[1];
  v[n - 1] = v[n - 2];
  const sv = smooth(v, 3);
  let pi = phases.address;
  for (let i = phases.address; i <= Math.min(phases.finish, n - 1); i++) if (sv[i] > sv[pi]) pi = i;
  return { t: times.slice(), v: sv, peak: sv[pi], peakT: times[pi], impact: sv[phases.impact] };
}

// Rotation of a left-right landmark pair about the vertical axis, from (x, z).
// MediaPipe z is a monocular depth estimate — usable for order/trend, not exact degrees.
function rotationDeg(frames: Frame[], iL: number, iR: number): number[] | null {
  const n = frames.length;
  const raw = new Array<number>(n).fill(NaN);
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f && f[iL].z !== undefined && f[iR].z !== undefined) {
      raw[i] = Math.atan2(f[iR].z! - f[iL].z!, f[iR].x - f[iL].x);
      valid++;
    }
  }
  if (valid < n * 0.6) return null;
  let prevI = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(raw[i])) continue;
    if (prevI >= 0) {
      let d = raw[i] - raw[prevI];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      raw[i] = raw[prevI] + d;
    }
    prevI = i;
  }
  return smooth(interpNaN(raw), 5).map((r) => (r * 180) / Math.PI);
}

export function computeSequence(
  frames: Frame[],
  times: number[],
  phases: Phases,
  hands: SpeedAnalysis | null
): { sequence: SequenceAnalysis | null; xfactor: XFactor | null } {
  const none = { sequence: null, xfactor: null };
  if (!hands) return none;
  const n = frames.length;
  const sh = rotationDeg(frames, L_SH, R_SH);
  const hip = rotationDeg(frames, L_HIP, R_HIP);
  if (!sh || !hip) return none;

  // Sign-normalize so the backswing coil reads positive regardless of handedness/camera side.
  const turn = sh[phases.top] - sh[phases.address];
  if (Math.abs(turn) < 25) return none; // too little visible rotation to trust
  const s = turn > 0 ? 1 : -1;
  const shN = sh.map((a) => (a - sh[phases.address]) * s);
  const hipN = hip.map((a) => (a - hip[phases.address]) * s);

  // Post-smoothing jumps mean the depth estimate was garbage in this clip.
  for (let i = 1; i < n; i++)
    if (Math.abs(shN[i] - shN[i - 1]) > 65 || Math.abs(hipN[i] - hipN[i - 1]) > 65) return none;

  // Angular speed toward the target (positive during the downswing).
  const omega = (a: number[]) => {
    const o = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const dt = times[i + 1] - times[i - 1];
      if (dt > 0) o[i] = -(a[i + 1] - a[i - 1]) / dt;
    }
    o[0] = o[1];
    o[n - 1] = o[n - 2];
    return smooth(o, 3);
  };
  const wP = omega(hipN);
  const wT = omega(shN);

  const lo = Math.max(phases.address, phases.top - 2);
  const hi = Math.min(n - 1, phases.impact + 2);
  const peakIn = (arr: number[]) => {
    let b = lo;
    for (let i = lo; i <= hi; i++) if (arr[i] > arr[b]) b = i;
    return b;
  };
  const pP = peakIn(wP);
  const pT = peakIn(wT);
  const pH = peakIn(hands.v);
  if (wP[pP] < 60 || wT[pT] < 60) return none; // no real downswing rotation signal

  const tImpact = times[phases.impact];
  const peaks: SequencePeak[] = [
    { name: "pelvis" as const, t: times[pP], msBeforeImpact: Math.round((tImpact - times[pP]) * 1000) },
    { name: "torso" as const, t: times[pT], msBeforeImpact: Math.round((tImpact - times[pT]) * 1000) },
    { name: "hands" as const, t: times[pH], msBeforeImpact: Math.round((tImpact - times[pH]) * 1000) },
  ].sort((a, b) => a.t - b.t);
  const textbook = peaks[0].name === "pelvis" && peaks[1].name === "torso" && peaks[2].name === "hands";

  const sequence: SequenceAnalysis = { t: times.slice(), pelvis: wP, torso: wT, hands: hands.v, peaks, textbook };

  // X-factor: shoulder–hip separation. Top value vs peak in the early downswing —
  // the stretch (not the static top number) is what separates skill levels in the research.
  const xf = shN.map((a, i) => a - hipN[i]);
  const xfTop = xf[phases.top];
  let xPeakI = phases.top;
  const xHi = Math.min(n - 1, phases.top + Math.max(2, Math.ceil((phases.impact - phases.top) * 0.7)));
  for (let i = phases.top; i <= xHi; i++) if (xf[i] > xf[xPeakI]) xPeakI = i;
  const xfactor: XFactor | null =
    xfTop > 12
      ? { topDeg: xfTop, peakDeg: xf[xPeakI], peakT: times[xPeakI], stretchPct: ((xf[xPeakI] - xfTop) / xfTop) * 100 }
      : null;

  return { sequence, xfactor };
}

// Gate for long-video windows: did this segment actually contain a swing?
export function swingQuality(frames: Frame[], phases: Phases, fps: number): Quality {
  const n = frames.length;
  const span = Math.max(1, phases.finish - phases.address + 1);
  let det = 0;
  for (let i = phases.address; i <= phases.finish; i++) if (frames[i]) det++;
  if (det / span < 0.4) return { ok: false, reason: "body tracking too patchy" };
  const back = (phases.top - phases.address) / fps;
  const down = (phases.impact - phases.top) / fps;
  if (back < 0.25 || back > 3.5) return { ok: false, reason: "no clear backswing" };
  if (down < 0.06 || down > 1.3) return { ok: false, reason: "no clear downswing" };
  const hy = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f) hy[i] = (f[L_WRIST].y + f[R_WRIST].y) / 2;
  }
  const sig = smooth(interpNaN(hy), 5);
  const scale = bodyHeight(nearest(frames, phases.address));
  if ((sig[phases.address] - sig[phases.top]) / scale < 0.22)
    return { ok: false, reason: "hands never rose like a swing" };
  return { ok: true };
}

export function analyzeSwing(frames: Frame[], fps: number, times?: number[]): Analysis {
  const det = frames.filter(Boolean).length;
  const phases = detectPhases(frames);
  const ts = times && times.length === frames.length ? times : frames.map((_, i) => i / fps);
  const metrics = computeMetrics(frames, phases, fps);
  const speed = computeSpeed(frames, ts, phases);
  const { sequence, xfactor } = computeSequence(frames, ts, phases, speed);
  return {
    phases,
    times: {
      address: ts[phases.address],
      top: ts[phases.top],
      impact: ts[phases.impact],
      finish: ts[phases.finish],
    },
    metrics,
    faults: flagFaults(metrics),
    notes: watchNotes(metrics),
    detectedPct: (100 * det) / frames.length,
    fps,
    speed,
    sequence,
    xfactor,
    quality: swingQuality(frames, phases, fps),
  };
}
