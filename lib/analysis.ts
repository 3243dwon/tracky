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

export type Fault = { title: string; mishit: string; detail: string; fix: string; focus: string };

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

export type Quality = { ok: boolean; reason?: string; confidence?: "high" | "low" };

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
  // Hip sway is only meaningful face-on (it's a target-line metric); on a down-the-line
  // clip the horizontal number is noise, so the hip arm of this fault is gated to face-on
  // — head vertical/lateral travel still fires from any view.
  if (m.headSwayPct > 15 || (m.view === "face-on" && Math.abs(m.hipSwayBackPct) > 18))
    f.push({
      title: "Excess lateral sway · 横向晃动过大",
      mishit:
        "the swing's low point is sliding with you, so the club bottoms out in a different spot every time — that's the fat/thin pattern, and ball-striking is the single thing that most separates handicaps (Shot Scope: greens-in-reg fall from 61% at scratch to ~10% by 25-handicap). 挥杆的最低点跟着你一起平移，每次触地点都不一样——这就是打肥/打薄，而触球质量正是最能拉开差点的因素（Shot Scope：标准杆上果岭率从 scratch 的 61% 一路掉到 25 差点的约 10%）。",
      detail:
        m.view === "face-on"
          ? `head ${m.headSwayPct.toFixed(0)}% / hip ${sign(m.hipSwayBackPct)}% of body height — steady ball-strikers hold both under ~10% · 头 ${m.headSwayPct.toFixed(0)}% / 髋 ${sign(m.hipSwayBackPct)}%（占身高），触球稳定的球手两者都在约 10% 以内`
          : `head ${m.headSwayPct.toFixed(0)}% of body height — steady ball-strikers hold it under ~10% · 头 ${m.headSwayPct.toFixed(0)}%（占身高），触球稳定的球手控制在约 10% 以内`,
      fix: "Rotate around a stable centre instead of sliding off the ball — the hips can turn hard while the head stays over it, the way Rory McIlroy's does. Drill the feel: stand an alignment stick (or a chair) just outside your trail hip and swing without touching it. Re-film; head-sway under ~10% means it's holding. 绕着一个稳定中心旋转，别整个滑出球外——髋可以转得很猛，同时头一直留在球上方，像罗里·麦克罗伊那样。练这个感觉：在后侧髋外侧立一根定位杆（或一把椅子），挥杆时别碰到它。重拍——头部横向晃动压到约 10% 以内就说明稳住了。",
      focus: "strike consistency",
    });
  if (m.headVertPct > 12)
    f.push({
      title: "Head lifts or dips through the swing · 挥杆中头部上下起伏",
      mishit:
        "your head is the centre of the swing's radius — when it climbs or drops, the bottom of the arc moves with it, which is precisely how you top one ball and catch the next one thin. 头是挥杆半径的圆心——它一上一下，弧线的最低点就跟着移动，你这一球打顶、下一球打薄，正是这么来的。",
      detail: `${m.headVertPct.toFixed(0)}% of body height vertically — under ~8% and the strike steadies · 垂直方向占身高 ${m.headVertPct.toFixed(0)}%，压到约 8% 以内触球就稳了`,
      fix: "Keep your spine angle and turn through the ball rather than standing up to 'help' it into the air — that's the steady-head look you see in Tiger Woods. Stay in your posture and feel your chest height hold until the ball's gone. Re-film; aim for under ~8%. 保持脊柱角度、转身穿过球，而不是站起来「帮」球起飞——这就是你在老虎·伍兹身上看到的那种稳定头部。保持体态，感觉胸口高度一直稳住，直到球飞走。重拍，目标控制在约 8% 以内。",
      focus: "strike consistency",
    });
  if (!Number.isNaN(m.tempoRatio) && m.tempoRatio < 1.8)
    f.push({
      title: "Rushed transition · 过渡太急（抢节奏）",
      mishit:
        "you're starting down before the backswing finishes, so the pelvis → torso → hands chain never stacks up — and that last link is where the clubhead nearly doubles its speed. Rush it and you leak both speed and a square face. 上杆还没到顶你就开始下杆，骨盆 → 躯干 → 手的发力链没叠起来——而正是最后这一环，杆头速度几乎翻倍。抢这一下，速度和正杆面都会漏掉。",
      detail: `tempo ${m.tempoRatio.toFixed(1)}:1 — tour rhythm sits near 3:1 back-to-through, almost regardless of the player · 节奏 ${m.tempoRatio.toFixed(1)}:1，巡回赛的上杆:下杆几乎人人都在 3:1 附近`,
      fix: "Let the sequence build the speed rather than hitting hard from the top — an unhurried transition, like Rory McIlroy's, lets the pelvis → torso → hands chain load in order. Count '1-2' going back, '1' coming down (~3:1), and pause a hair at the top before you start down. Re-film; tempo drifting toward 3:1 with crisper contact. 让发力顺序去产生速度，而不是从顶点猛抽一下——像罗里·麦克罗伊那样不慌不忙的转换，能让骨盆 → 躯干 → 手依次蓄力。上杆数「1-2」、下杆数「1」（约 3:1），到顶点稍停一丁点再下杆。重拍，节奏往 3:1 靠、触球更扎实。",
      focus: "tempo",
    });
  return f;
}

export function watchNotes(m: Metrics): string[] {
  const notes: string[] = [];
  if (Math.abs(m.secondaryTiltDeg) > 15)
    notes.push(
      `Spine angle changes ${sign(m.secondaryTiltDeg)}° from address to impact — if you filmed down-the-line, a big stand-up can mean early extension (thins/shanks). Confirm with a clean DTL clip. · 脊柱角度从瞄球到触球变化了 ${sign(m.secondaryTiltDeg)}°——若是后方视角（DTL）拍摄，明显起身可能是提前伸展（early extension，易打薄/打 shank），建议用一段清晰的后方视角再确认。`
    );
  if (m.reverseSpineDeg > 10)
    notes.push(
      `Upper body may lean toward the target at the top (~${m.reverseSpineDeg.toFixed(0)}°) — possible reverse pivot; confirm on a DTL clip. · 上杆顶点时上半身可能倒向目标方向（约 ${m.reverseSpineDeg.toFixed(0)}°），可能是反向重心转移（reverse pivot），用后方视角确认一下。`
    );
  return notes;
}

// Linear interpolation over NaN gaps (two-pointer, O(n)).
export function interpNaN(a: number[]): number[] {
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
  // Loosened from 0.4: a small/occluded golfer at a range legitimately drops below
  // 40% detected frames; detectPhases already interpolates gaps and the derived
  // analyses (speed/sequence) suppress garbage via their own validity checks.
  if (det / span < 0.3) return { ok: false, reason: "body tracking too patchy" };
  const back = (phases.top - phases.address) / fps;
  const down = (phases.impact - phases.top) / fps;
  // Backswing ceiling raised to 6s so a slow-mo (120/240fps) clip — where the whole
  // swing plays back stretched — isn't rejected. The downswing ceiling is RELATIVE
  // (a real downswing is quicker than the backswing) so it's slow-mo-invariant, but
  // ABSOLUTELY CAPPED at 3s: a mislocated 'top' inflates `back`, and without the cap that
  // would loosen this gate onto the exact non-swing it should reject. The real backstop for
  // a low-energy non-swing is the hand-rise check below, not this clause.
  if (back < 0.25 || back > 6.0) return { ok: false, reason: "no clear backswing" };
  if (down < 0.06 || down > Math.min(3.0, Math.max(1.3, back * 0.95)))
    return { ok: false, reason: "no clear downswing" };
  const hy = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f) hy[i] = (f[L_WRIST].y + f[R_WRIST].y) / 2;
  }
  const sig = smooth(interpNaN(hy), 5);
  const scale = bodyHeight(nearest(frames, phases.address));
  // Loosened from 0.22: down-the-line wrist occlusion + the 5-wide smoother + NaN
  // interpolation systematically under-measure the top-of-backswing rise. 0.16 of
  // body height is still a clearly upward hand path a stationary person can't fake.
  const rise = (sig[phases.address] - sig[phases.top]) / scale;
  if (rise < 0.16) return { ok: false, reason: "hands never rose like a swing" };
  // Confidence: require clean tracking, a clear rise, and real swing tempo — backswing
  // distinctly longer than downswing (~2-3:1). That ratio test is scale-invariant (slow-mo
  // still reads high) and, unlike `down < back`, isn't auto-satisfied when a mislocated top
  // balloons `back`: a down≈back motion (waggle / walk-up / bad top) reads LOW even when both
  // times are large. Low-confidence makes the UI hedge and drop the prescriptive drills.
  const confidence: "high" | "low" = det / span >= 0.4 && rise >= 0.22 && back > down * 1.5 ? "high" : "low";
  return { ok: true, confidence };
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
