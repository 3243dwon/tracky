// TypeScript port of club_path.py (swing-cv v3.5): trace the clubhead from
// frame-to-frame motion and read its arc. The body model can't see the club, so
// we use the one thing that's always true — the clubhead is the fastest-moving
// thing in frame. We mask motion to a disc around the hands (pose gives us those),
// follow the leading tip of that motion, and read whether the downswing comes
// down WIDER/outside the backswing — the over-the-top, slice/pull-producing path.
//
// Honest 2D limits hold (same as the rest of the app): one camera can't see the
// clubFACE, so it can't separate a slice from a pull, and speed is RELATIVE
// (body-heights/frame), not mph. The verdict is gated on a trace-quality score
// so a noisy motion track stays quiet instead of inventing a fault.
import { L_WRIST, R_WRIST, L_HIP, R_HIP, NOSE, L_ANK, R_ANK } from "./analysis";
import type { Frame, Phases, Fault } from "./analysis";
import type { MotionStack } from "./pose";

// Tuning constants — mirror club_path.py so the two implementations agree.
const MOTION_K = 2.5;       // a pixel is "moving" if diff > mean + K*std (of moving pixels)
const R_MIN_BODY = 0.1;     // clubhead at least this far from the grip (× body height)
const R_MAX_BODY = 0.75;    // ...and at most this far (arm + shaft reach)
const PRED_PULL_GATE = 0.35; // continuity gate radius (× r_max) around the predicted spot
const MAX_JUMP_BODY = 0.45; // reject a frame whose head leaps more than this (× body height)

// Which hand the golfer plays — flips the directional corrective in the verdict
// (an over-the-top path is the same FAULT for both, but the feel-cue mirrors).
export type Hand = "R" | "L";

export type ClubPoint = { x: number; y: number; conf: number } | null;
export type ClubAnalysis = {
  path: ClubPoint[];          // normalized [0..1] clubhead per frame (null where unknown)
  coveragePct: number;        // % of the address→impact window we tracked
  quality: number;            // 0..1 arc smoothness (gates the verdict)
  meanTurnDeg: number;
  loopPct: number;            // + = downswing arc wider/outside backswing (over the top)
  peakSpeedPct: number;       // body-heights/frame near impact (relative)
  nBack: number;
  nDown: number;
  fault: Fault | null;
};

function bodyHeight(lm: NonNullable<Frame>): number {
  const ax = (lm[L_ANK].x + lm[R_ANK].x) / 2, ay = (lm[L_ANK].y + lm[R_ANK].y) / 2;
  return Math.hypot(lm[NOSE].x - ax, lm[NOSE].y - ay) || 0.1;
}

function gripOf(lm: NonNullable<Frame>): [number, number] {
  return [(lm[L_WRIST].x + lm[R_WRIST].x) / 2, (lm[L_WRIST].y + lm[R_WRIST].y) / 2];
}

function nearestFrame(frames: Frame[], i: number): NonNullable<Frame> | null {
  if (frames[i]) return frames[i]!;
  for (let d = 1; d < frames.length; d++) {
    if (frames[i - d]) return frames[i - d]!;
    if (frames[i + d]) return frames[i + d]!;
  }
  return null;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

function medianOf(arr: number[]): number {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// --- Pass over the motion frames: one clubhead estimate per frame. ---
export function trackClubhead(motion: MotionStack, frames: Frame[], phases: Phases): ClubPoint[] {
  const n = frames.length;
  const { w: tw, h: th, data } = motion;
  const out: ClubPoint[] = new Array(n).fill(null);
  if (data.length < 2) return out;

  // Grip (wrist midpoint) per frame, interpolated over gaps — anchors the search.
  const gx = new Array<number>(n).fill(NaN);
  const gy = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f) { const g = gripOf(f); gx[i] = g[0]; gy[i] = g[1]; }
  }
  const good: number[] = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(gx[i])) good.push(i);
  if (good.length < 2) return out;
  const fill = (a: number[]) => {
    let prev = -1;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(a[i])) {
        if (prev === -1) for (let j = 0; j < i; j++) a[j] = a[i];
        else if (i - prev > 1) for (let j = prev + 1; j < i; j++) a[j] = a[prev] + ((a[i] - a[prev]) * (j - prev)) / (i - prev);
        prev = i;
      }
    }
    if (prev >= 0) for (let j = prev + 1; j < n; j++) a[j] = a[prev];
  };
  fill(gx); fill(gy);

  const addr = nearestFrame(frames, phases.address);
  const scale = addr ? bodyHeight(addr) : 0.6;
  const rMin = R_MIN_BODY * scale * th;
  const rMax = R_MAX_BODY * scale * th;

  let last: [number, number] | null = null;
  let last2: [number, number] | null = null;

  const lim = Math.min(n, data.length);
  for (let i = 1; i < lim; i++) {
    const cur = data[i], prv = data[i - 1];
    const gpx = gx[i] * tw, gpy = gy[i] * th;

    // 1) Diff, but only INSIDE the arm+shaft disc around the hands. A driving
    // range is full of background motion; the club is never out there.
    const r2max = rMax * rMax, r2min = rMin * rMin;
    let sum = 0, cnt = 0;
    const diff = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) {
      const dy = y - gpy;
      for (let x = 0; x < tw; x++) {
        const dx = x - gpx;
        const r2 = dx * dx + dy * dy;
        if (r2 < r2min || r2 > r2max) continue;
        const k = y * tw + x;
        const d = Math.abs(cur[k] - prv[k]);
        diff[k] = d;
        sum += d; cnt++;
      }
    }
    if (cnt < 4) continue;
    const mean = sum / cnt;
    let vars = 0;
    for (let k = 0; k < diff.length; k++) if (diff[k] > 0) vars += (diff[k] - mean) ** 2;
    const std = Math.sqrt(vars / Math.max(1, cnt));
    const thr = Math.max(mean + MOTION_K * std, 10);

    // strong-motion pixels (inside the disc)
    const xs: number[] = [], ys: number[] = [];
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        if (diff[y * tw + x] > thr) { xs.push(x); ys.push(y); }
      }
    }
    if (xs.length < 2) continue;

    // 2) Where do we expect the head? Extrapolate its last motion; before we have
    // one, assume it hangs down-and-out from the grip.
    const pred: [number, number] = last && last2
      ? [2 * last[0] - last2[0], 2 * last[1] - last2[1]]
      : last
      ? last
      : [gpx, gpy + 0.5 * rMax];

    // 3) Continuity gate: keep motion near the prediction so we follow one object.
    const gate = Math.max(PRED_PULL_GATE * rMax, 0.18 * th);
    let fx = xs, fy = ys;
    const near = (g: number) => {
      const kx: number[] = [], ky: number[] = [];
      for (let j = 0; j < xs.length; j++) {
        if (Math.hypot(xs[j] - pred[0], ys[j] - pred[1]) <= g) { kx.push(xs[j]); ky.push(ys[j]); }
      }
      return [kx, ky] as const;
    };
    let [kx, ky] = near(gate);
    if (kx.length < 2) [kx, ky] = near(2 * gate);
    if (kx.length >= 2) { fx = kx; fy = ky; }

    // 4) The clubhead is the LEADING TIP of the motion smear — the farthest-from-
    // grip slice of moving pixels — median'd for stability.
    const dg = fx.map((x, j) => Math.hypot(x - gpx, fy[j] - gpy));
    const cut = percentile(dg, 75);
    const tipX: number[] = [], tipY: number[] = [];
    for (let j = 0; j < dg.length; j++) if (dg[j] >= cut) { tipX.push(fx[j]); tipY.push(fy[j]); }
    const cxp = medianOf(tipX), cyp = medianOf(tipY);

    if (!last || Math.hypot(cxp - last[0], cyp - last[1]) <= MAX_JUMP_BODY * th) {
      out[i] = { x: cxp / tw, y: cyp / th, conf: Math.min(1, xs.length / 30) };
      last2 = last;
      last = [cxp, cyp];
    }
  }

  return cleanPath(out);
}

// Drop lone outliers (a frame whose jump dwarfs both neighbours), then a light
// 3-tap smooth over runs of tracked frames (don't bridge gaps).
function cleanPath(path: ClubPoint[]): ClubPoint[] {
  const n = path.length;
  const xs = path.map((p) => (p ? p.x : NaN));
  const ys = path.map((p) => (p ? p.y : NaN));
  const cf = path.map((p) => (p ? p.conf : 0));
  for (const arr of [xs, ys]) {
    for (let i = 1; i < n - 1; i++) {
      if (Number.isNaN(arr[i])) continue;
      if (!Number.isNaN(arr[i - 1]) && !Number.isNaN(arr[i + 1])) {
        const local = (arr[i - 1] + arr[i + 1]) / 2;
        if (Math.abs(arr[i] - local) > 0.45) arr[i] = NaN;
      }
    }
  }
  const sx = xs.slice(), sy = ys.slice();
  for (let i = 1; i < n - 1; i++) {
    if (!Number.isNaN(xs[i - 1]) && !Number.isNaN(xs[i]) && !Number.isNaN(xs[i + 1])) {
      sx[i] = (xs[i - 1] + xs[i] + xs[i + 1]) / 3;
      sy[i] = (ys[i - 1] + ys[i] + ys[i + 1]) / 3;
    }
  }
  return path.map((_, i) =>
    Number.isNaN(sx[i]) || Number.isNaN(sy[i]) ? null : { x: sx[i], y: sy[i], conf: cf[i] }
  );
}

type ArcPt = { i: number; x: number; y: number };
function arc(path: ClubPoint[], lo: number, hi: number): ArcPt[] {
  const pts: ArcPt[] = [];
  for (let i = lo; i <= hi; i++) {
    const p = path[i];
    if (i >= 0 && i < path.length && p && p.conf > 0.05) pts.push({ i, x: p.x, y: p.y });
  }
  return pts;
}

// Read the traced arc → over-the-top loop, relative speed, quality, and a fault.
export function analyzeClubPath(path: ClubPoint[], frames: Frame[], phases: Phases, hand: Hand = "R"): ClubAnalysis {
  const { address: a, top: t, impact: im } = phases;
  const addr = nearestFrame(frames, a);
  const scale = addr ? bodyHeight(addr) : 0.6;
  const bodyC: [number, number] = addr
    ? [(addr[L_HIP].x + addr[R_HIP].x) / 2, (addr[L_HIP].y + addr[R_HIP].y) / 2]
    : [0.5, 0.5];

  const back = arc(path, a, t);
  const down = arc(path, t, im);
  const win = Math.max(1, im - a);
  let tracked = 0;
  for (let i = a; i <= im; i++) if (path[i] && path[i]!.conf > 0.05) tracked++;
  const coveragePct = (tracked / (win + 1)) * 100;

  // Over-the-top: radius-from-body vs height, matched between the two arcs.
  let loopPct = NaN;
  if (back.length >= 3 && down.length >= 3) {
    const byHeight = (pts: ArcPt[]) => {
      const hs = pts.map((p) => p.y);
      const rs = pts.map((p) => Math.hypot(p.x - bodyC[0], p.y - bodyC[1]));
      const order = hs.map((_, j) => j).sort((p, q) => hs[p] - hs[q]);
      return { h: order.map((j) => hs[j]), r: order.map((j) => rs[j]) };
    };
    const interp = (h: number[], r: number[], at: number) => {
      if (at <= h[0]) return r[0];
      if (at >= h[h.length - 1]) return r[r.length - 1];
      for (let j = 1; j < h.length; j++) {
        if (at <= h[j]) {
          const f = (at - h[j - 1]) / Math.max(1e-6, h[j] - h[j - 1]);
          return r[j - 1] + f * (r[j] - r[j - 1]);
        }
      }
      return r[r.length - 1];
    };
    const B = byHeight(back), D = byHeight(down);
    const lo = Math.max(B.h[0], D.h[0]);
    const hi = Math.min(B.h[B.h.length - 1], D.h[D.h.length - 1]);
    if (hi > lo) {
      let acc = 0;
      const N = 6;
      for (let s = 0; s < N; s++) {
        const at = lo + 0.05 * (hi - lo) + ((hi - lo) * 0.9 * s) / (N - 1);
        acc += interp(D.h, D.r, at) - interp(B.h, B.r, at);
      }
      loopPct = (acc / N / scale) * 100;
    }
  }

  // Relative clubhead speed: peak travel/frame near impact.
  const speeds: number[] = [];
  for (let i = Math.max(a + 1, im - 8); i < Math.min(path.length, im + 3); i++) {
    if (path[i] && path[i - 1]) {
      speeds.push((Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y) / scale) * 100);
    }
  }
  const peakSpeedPct = speeds.length ? Math.max(...speeds) : NaN;

  // Trace quality: mean turn-angle between consecutive steps over the swing.
  const pts = arc(path, a, im);
  const angles: number[] = [];
  for (let k = 1; k < pts.length - 1; k++) {
    const v1 = [pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y];
    const v2 = [pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y];
    const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
    if (n1 > 1e-4 && n2 > 1e-4) {
      const cosa = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)));
      angles.push((Math.acos(cosa) * 180) / Math.PI);
    }
  }
  const meanTurnDeg = angles.length ? angles.reduce((s, v) => s + v, 0) / angles.length : 180;
  const quality = Math.max(0, Math.min(1, 1 - meanTurnDeg / 90));

  const m: ClubAnalysis = {
    path,
    coveragePct,
    quality,
    meanTurnDeg,
    loopPct,
    peakSpeedPct,
    nBack: back.length,
    nDown: down.length,
    fault: null,
  };
  m.fault = clubFault(m, hand);
  return m;
}

export function clubFault(m: ClubAnalysis, hand: Hand = "R"): Fault | null {
  if (!Number.isNaN(m.loopPct) && m.loopPct > 6 && m.coveragePct > 45 && m.quality > 0.4) {
    // The over-the-top out-to-in path is the same FAULT for both hands (and produces
    // a slice/pull for both — mirrored in absolute direction). Only the feel-cue —
    // which way "out away from the ball" points — flips with handedness.
    const dirEn = hand === "L" ? "left" : "right";
    const handEn = hand === "L" ? "left-hander" : "right-hander";
    const dirZh = hand === "L" ? "左" : "右";
    const handZh = hand === "L" ? "左手球手" : "右手球手";
    return {
      title: "Over-the-top transition (out-to-in path) · 出杆过顶（外到内轨迹）",
      mishit:
        "the clubhead is starting down outside the ball and cutting across it — that out-to-in path is the engine behind the slice (and the pull). Path is only half the story, though: one camera can't read your face angle, so it can't tell a slice from a pull. 杆头从球的外侧开始下来、再横切过球——这条外到内的路径正是右曲球（和拉球）的根源。但路径只是一半：单摄像头读不到杆面角度，所以分不清右曲和拉球。",
      detail: `downswing arc ~${m.loopPct.toFixed(0)}% of body height wider than the backswing at matched height — you want the magenta downswing tucking INSIDE the cyan backswing · 下杆弧线在同高度比上杆宽约 ${m.loopPct.toFixed(0)}%（占身高）——理想是洋红下杆线收到青色上杆线的内侧`,
      fix: `Tour players deliver from the INSIDE — they shallow the club in transition instead of throwing it out over the top. Set a headcover or towel just outside the ball and miss it coming down — feel the club drop behind you and swing out to the ${dirEn} (${handEn}). Groove it slow, then keep the feel at speed. Re-film; the magenta downswing arc should tuck inside the cyan backswing. 巡回赛球手都是从内侧交付——他们在转换时让杆变平（shallow），而不是把杆甩到外侧、过顶。在球外侧放杆头套或毛巾，下杆避开它——感受杆子掉到身后、向${dirZh}（${handZh}）打出去。先慢动作打进去，再带速度保持这个感觉。重拍：洋红下杆弧线应收到青色上杆线的内侧。`,
      focus: "slice / swing path",
    };
  }
  return null;
}

// Top-level helper: returns null when there's no motion data or too few frames.
export function analyzeClub(motion: MotionStack | null, frames: Frame[], phases: Phases, hand: Hand = "R"): ClubAnalysis | null {
  if (!motion || motion.data.length < 6) return null;
  const path = trackClubhead(motion, frames, phases);
  return analyzeClubPath(path, frames, phases, hand);
}
